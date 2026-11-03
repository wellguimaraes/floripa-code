import { scopedProjectKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { PROJECT_ACTIVE_THREAD_CAP, type ScopedThreadRef } from "@t3tools/contracts";

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
  /** Seconds since `lastReplyAt`; set by `ageReplies`, which knows the time. */
  readonly replyAgeSeconds: number;
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
  /**
   * How many subagents this figure stands for. One, unless it is the single
   * copy an agent shows for all of its subagents.
   */
  readonly subagentCount: number;
}

/** Done with its turn and waiting on nothing: resting on the beach. */
export function isResting(facts: CharacterFacts): boolean {
  return (
    (facts.status === "ready" || facts.status === "waiting") &&
    !facts.hasWorkingKids &&
    !facts.backgroundTask
  );
}

/** Working, waiting on you, or waiting on its kids or a background task. */
function isBusy(facts: CharacterFacts): boolean {
  return (
    facts.status === "working" ||
    facts.status === "approval" ||
    facts.status === "input" ||
    (facts.status === "waiting" && facts.hasWorkingKids) ||
    ((facts.status === "ready" || facts.status === "waiting") && facts.backgroundTask)
  );
}

/**
 * How long an island's agents have all sat idle: the age of its latest reply. Null while any
 * of them is busy, or with nobody there.
 */
export function islandIdleSeconds(facts: ReadonlyArray<CharacterFacts>): number | null {
  if (facts.length === 0 || facts.some(isBusy)) return null;
  return Math.min(...facts.map((fact) => fact.replyAgeSeconds));
}

/** Fills in `replyAgeSeconds` as of `now`. */
export function ageReplies(facts: ReadonlyArray<CharacterFacts>, now: number): CharacterFacts[] {
  return facts.map((fact) => ({
    ...fact,
    replyAgeSeconds: Math.max(0, (now - Date.parse(fact.lastReplyAt)) / 1000),
  }));
}

/**
 * The most recently updated agents on each island, at most
 * `PROJECT_ACTIVE_THREAD_CAP`, each with its subagents. The server archives
 * past the cap, so this only guards against servers that predate it.
 */
function chooseThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  byId: ReadonlyMap<string, EnvironmentThreadShell>,
): EnvironmentThreadShell[] {
  const sorted = threads.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // A family's root: the nearest ancestor still in the shell, so a subagent
  // whose parent is archived stands on its own.
  const rootOf = (thread: EnvironmentThreadShell) => {
    let current = thread;
    for (let depth = 0; depth < 32; depth += 1) {
      const parent = subagentParent(current, byId);
      if (parent === null) break;
      current = parent;
    }
    return current;
  };
  const perIsland = new Map<string, number>();
  const chosenRoots = new Set<string>();
  for (const thread of sorted) {
    if (rootOf(thread) !== thread) continue;
    const island = scopedProjectKey({
      environmentId: thread.environmentId,
      projectId: thread.projectId,
    });
    const count = perIsland.get(island) ?? 0;
    if (count >= PROJECT_ACTIVE_THREAD_CAP) continue;
    perIsland.set(island, count + 1);
    chosenRoots.add(threadKey(thread));
  }
  return sorted.filter((thread) => chosenRoots.has(threadKey(rootOf(thread))));
}

/**
 * Turns the thread shell into characters: the most recent agents on each
 * island, with subagents attached to their parent when the parent is present too.
 */
export function buildCharacterFacts(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** Browser-local visited watermarks, for servers without visited tracking. */
  readonly localLastVisitedAt: (key: string) => string | undefined;
}): CharacterFacts[] {
  const byId = new Map(input.threads.map((thread) => [thread.id as string, thread]));
  const chosen = chooseThreads(input.threads, byId);
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
      replyAgeSeconds: 0,
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
    subagentCount: 1,
  }));
}

/** Which subagent the single copy should act as. A question beats work beats rest. */
const SUBAGENT_ATTENTION = {
  approval: 0,
  input: 1,
  failed: 2,
  limited: 3,
  working: 4,
  waiting: 5,
  ready: 6,
} satisfies Record<SidebarThreadStatus, number>;

/**
 * One smaller figure per agent for all of its subagents. `subagentCount` on
 * that figure is how many it stands for, and `subagentsOf` still lists every
 * one so they can be archived together. The figure is the subagent that most
 * needs attention, and it stands next to the agent even when they were nested.
 */
export function collapseSubagents(facts: ReadonlyArray<CharacterFacts>): {
  readonly facts: CharacterFacts[];
  readonly subagentsOf: ReadonlyMap<string, readonly CharacterFacts[]>;
} {
  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  const rootKeyOf = (fact: CharacterFacts) => {
    let current = fact;
    for (let depth = 0; depth < 32 && current.parentKey !== null; depth += 1) {
      const parent = byKey.get(current.parentKey);
      if (parent === undefined) break;
      current = parent;
    }
    return current.kid ? fact.key : current.key;
  };

  const groups = new Map<string, CharacterFacts[]>();
  const grouped = new Set<string>();
  for (const fact of facts) {
    if (!fact.kid) continue;
    const rootKey = rootKeyOf(fact);
    const root = byKey.get(rootKey);
    if (root === undefined || root.kid) continue;
    const group = groups.get(rootKey);
    if (group === undefined) groups.set(rootKey, [fact]);
    else group.push(fact);
    grouped.add(fact.key);
  }

  const subagentsOf = new Map<string, readonly CharacterFacts[]>();
  const figureOf = new Map<string, CharacterFacts>();
  for (const [rootKey, kids] of groups) {
    const root = byKey.get(rootKey);
    const lead = leadSubagent(kids);
    if (root === undefined || lead === undefined) continue;
    subagentsOf.set(rootKey, kids);
    figureOf.set(rootKey, {
      ...lead,
      subagentCount: kids.length,
      parentKey: rootKey,
    });
  }

  const shown = facts.flatMap((fact) => {
    if (grouped.has(fact.key)) return [];
    const kids = groups.get(fact.key);
    if (kids === undefined) return [fact];
    return [
      {
        ...fact,
        hasWorkingKids:
          fact.hasWorkingKids || kids.some((kid) => kid.status === "working" || kid.hasWorkingKids),
      },
    ];
  });
  for (const figure of figureOf.values()) shown.push(figure);
  return { facts: shown, subagentsOf };
}

function leadSubagent(kids: readonly CharacterFacts[]): CharacterFacts | undefined {
  let lead: CharacterFacts | undefined;
  for (const kid of kids) {
    if (lead === undefined) {
      lead = kid;
      continue;
    }
    const rank = SUBAGENT_ATTENTION[kid.status] - SUBAGENT_ATTENTION[lead.status];
    if (rank < 0 || (rank === 0 && lead.quiet && !kid.quiet)) lead = kid;
    else if (rank === 0 && kid.quiet === lead.quiet && kid.lastReplyAt > lead.lastReplyAt) {
      lead = kid;
    }
  }
  return lead;
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
