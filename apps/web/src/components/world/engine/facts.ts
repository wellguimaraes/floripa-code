import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";

import {
  hasUnseenCompletion,
  resolveSidebarThreadStatus,
  resolveThreadLastVisitedAt,
  type SidebarThreadStatus,
} from "../../Sidebar.logic";

/** Everything rules may match on, plus what the renderer needs to draw one character. */
export interface CharacterFacts {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly title: string;
  readonly createdAt: string;
  /** When the agent last replied: its latest run's end, else the thread's last update. */
  readonly lastReplyAt: string;
  readonly status: SidebarThreadStatus;
  readonly unread: boolean;
  /** A subagent whose parent is also in the world. */
  readonly kid: boolean;
  readonly parentKey: string | null;
  /** A kid is working, or the thread waits on a background subagent. */
  readonly hasWorkingKids: boolean;
  /** A background task other than a subagent, such as a long command, is still running. */
  readonly backgroundTask: boolean;
  /**
   * Grows as the thread's work advances (its item count): one nugget per
   * beat. See `gateBeats` for the pacing.
   */
  readonly beat: number;
  /** No new output for a while; set by `gateBeats`, which knows the timing. */
  readonly quiet: boolean;
  readonly provider: string;
  /** The island the character lives on: its project, or its parent's for a kid. */
  readonly projectKey: string;
  /** Nearest ancestor that is not a subagent, so kids share their parent's look. */
  readonly lookSeed: string;
  /** The worktree folder the thread works in; null in the project's own checkout. */
  readonly worktreePath: string | null;
}

const WORLD_CHARACTER_LIMIT = 30;

/**
 * Turns the thread shell into characters: the most recently updated threads,
 * with subagents attached to their parent when the parent is present too.
 */
export function buildCharacterFacts(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** Browser-local visited watermarks, for servers without visited tracking. */
  readonly localLastVisitedAt: (key: string) => string | undefined;
  readonly limit?: number;
}): CharacterFacts[] {
  const byId = new Map(input.threads.map((thread) => [thread.id as string, thread]));
  const chosen = input.threads
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, input.limit ?? WORLD_CHARACTER_LIMIT);
  const chosenKeys = new Set(chosen.map((thread) => threadKey(thread)));

  const drafts = chosen.map((thread) => {
    const key = threadKey(thread);
    const parent = subagentParent(thread, byId);
    const parentKey = parent === null ? null : threadKey(parent);
    const kid = parentKey !== null && chosenKeys.has(parentKey);
    const lastVisitedAt = resolveThreadLastVisitedAt(
      thread.lastVisitedAt,
      input.localLastVisitedAt(key),
    );
    return {
      key,
      ref: { environmentId: thread.environmentId, threadId: thread.id },
      title: thread.title,
      createdAt: thread.createdAt,
      lastReplyAt: thread.latestRun?.completedAt ?? thread.updatedAt,
      status: subagentStatus(thread, parent),
      unread: hasUnseenCompletion({ ...thread, lastVisitedAt }),
      kid,
      parentKey: kid ? parentKey : null,
      backgroundTask: thread.pendingBackgroundTasks.some((task) => task.kind !== "subagent"),
      beat: thread.itemCount,
      quiet: false,
      provider: thread.providerInstanceId as string,
      projectKey: scopedProjectKey({
        environmentId: thread.environmentId,
        projectId: thread.projectId,
      }),
      lookSeed: lookSeed(thread, byId),
      worktreePath: thread.worktreePath,
    };
  });

  const parentsWithWorkingKids = new Set([
    ...drafts.flatMap((facts) =>
      facts.parentKey !== null && facts.status === "working" ? [facts.parentKey] : [],
    ),
    ...chosen.flatMap((thread) =>
      thread.pendingBackgroundTasks.some((task) => task.kind === "subagent")
        ? [threadKey(thread)]
        : [],
    ),
  ]);
  // A kid's desk is beside its parent, so the whole family lives on the
  // parent's island even when a subagent ran in another project.
  const draftByKey = new Map(drafts.map((facts) => [facts.key, facts]));
  const familyProject = (facts: (typeof drafts)[number]) => {
    let current = facts;
    for (let depth = 0; depth < 32 && current.parentKey !== null; depth += 1) {
      current = draftByKey.get(current.parentKey) ?? current;
    }
    return current.projectKey;
  };
  return drafts.map((facts) => ({
    ...facts,
    projectKey: familyProject(facts),
    hasWorkingKids: parentsWithWorkingKids.has(facts.key),
  }));
}

function threadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey({ environmentId: thread.environmentId, threadId: thread.id });
}

/**
 * A subagent thread owns no runs: its work happens inside its parent's, so on
 * its own it always reads as ready. It is working while the parent waits on it
 * in the background, or while the parent's current run has touched it.
 */
function subagentStatus(
  thread: EnvironmentThreadShell,
  parent: EnvironmentThreadShell | null,
): SidebarThreadStatus {
  const status = resolveSidebarThreadStatus(thread);
  if (parent === null || thread.runtime !== null || status !== "ready") return status;
  const waitedOn = parent.pendingBackgroundTasks.some(
    (task) =>
      task.kind === "subagent" && "childThreadId" in task && task.childThreadId === thread.id,
  );
  if (waitedOn) return "working";
  const runStartedAt = parent.latestRun?.startedAt ?? null;
  return resolveSidebarThreadStatus(parent) === "working" &&
    runStartedAt !== null &&
    thread.updatedAt >= runStartedAt
    ? "working"
    : status;
}

function subagentParent(
  thread: EnvironmentThreadShell,
  byId: ReadonlyMap<string, EnvironmentThreadShell>,
): EnvironmentThreadShell | null {
  if (thread.lineage.relationshipToParent !== "subagent") return null;
  const parentId = thread.lineage.parentThreadId;
  return parentId === null ? null : (byId.get(parentId) ?? null);
}

function lookSeed(
  thread: EnvironmentThreadShell,
  byId: ReadonlyMap<string, EnvironmentThreadShell>,
): string {
  let current = thread;
  // Bounded walk: lineage comes from the server, so never trust it to be acyclic.
  for (let depth = 0; depth < 32; depth += 1) {
    if (current.lineage.relationshipToParent !== "subagent") break;
    const parentId = current.lineage.parentThreadId;
    if (parentId === null) break;
    const parent = byId.get(parentId);
    // The parent is not in the shell (archived); its id still names the family.
    if (parent === undefined) return parentId;
    current = parent;
  }
  return current.id;
}
