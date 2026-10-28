import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestState,
  ScopedProjectRef,
} from "@t3tools/contracts";

import {
  type EnvironmentPullRequestEntry,
  pullRequestEntryViewer,
  type PullRequestViewers,
} from "../pullRequest/pullRequestList.logic";

/**
 * How many open PRs each island has whose head is one of its local branches or worktrees. The
 * server lists a repository once, under whichever of its checkouts it reached first, so the
 * match is against every branch on the island.
 */
export function countIslandPullRequests(
  islands: ReadonlyMap<string, ReadonlyArray<ScopedProjectRef>>,
  entries: ReadonlyArray<EnvironmentPullRequestEntry>,
  branchesOf: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const [island, listed] of groupIslandPullRequests(islands, entries)) {
    const branches = branchesOf.get(island);
    const count = listed.filter((entry) => branches?.has(entry.headBranch) === true).length;
    if (count > 0) counts.set(island, count);
  }
  return counts;
}

/**
 * Each island's listed PRs. Two environments holding the same repository both list its PRs, so
 * each appears once.
 */
export function groupIslandPullRequests(
  islands: ReadonlyMap<string, ReadonlyArray<ScopedProjectRef>>,
  entries: ReadonlyArray<EnvironmentPullRequestEntry>,
): ReadonlyMap<string, ReadonlyArray<EnvironmentPullRequestEntry>> {
  const islandOf = new Map<string, string>();
  for (const [island, members] of islands) {
    for (const member of members) islandOf.set(scopedProjectKey(member), island);
  }
  const grouped = new Map<string, Array<EnvironmentPullRequestEntry>>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const island = islandOf.get(
      scopedProjectKey({ environmentId: entry.environmentId, projectId: entry.projectId }),
    );
    if (island === undefined) continue;
    const id = `${island} ${pullRequestKey(entry)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    grouped.set(island, [...(grouped.get(island) ?? []), entry]);
  }
  return grouped;
}

/**
 * The listed PRs the viewer opened, or whose head is one of the island's local branches (the
 * default one aside, so a fork's PR from its own default branch stays out).
 */
export function ownIslandPullRequests(
  entries: ReadonlyArray<EnvironmentPullRequestEntry>,
  viewers: PullRequestViewers,
  localBranches: ReadonlySet<string>,
): ReadonlyArray<EnvironmentPullRequestEntry> {
  return entries.filter((entry) => {
    if (localBranches.has(entry.headBranch)) return true;
    const viewer = pullRequestEntryViewer(entry, viewers);
    return viewer !== null && entry.author?.login.trim().toLowerCase() === viewer;
  });
}

/** An agent on the island, as far as matching it to its PRs goes. */
export type IslandPullRequestAgent = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "projectId" | "branch" | "worktreePath" | "updatedAt" | "pullRequests"
>;

export interface IslandPullRequestRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly headBranch: string;
  readonly author: string | null;
  readonly updatedAt: string | null;
  /** The agent working on it, most recently updated first; null when none on the island is. */
  readonly agent: IslandPullRequestAgent | null;
}

const pullRequestKey = (pr: {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
}) => `${pr.host} ${pr.repository} ${pr.number}`;

/**
 * An island's PRs: every open one listed for its repository, plus the ones its agents linked,
 * merged and closed ones too. Each names the agent working on it, by link or by branch. Those
 * with an agent lead, open ones before the rest, then the most recently updated.
 */
export function listIslandPullRequests(
  entries: ReadonlyArray<EnvironmentPullRequestEntry>,
  agents: ReadonlyArray<IslandPullRequestAgent>,
): ReadonlyArray<IslandPullRequestRow> {
  const newestFirst = agents.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const linkedBy = new Map<string, IslandPullRequestAgent>();
  for (const agent of newestFirst) {
    for (const link of agent.pullRequests) {
      if (link.source === "stack-dismissed") continue;
      const key = pullRequestKey(link);
      if (!linkedBy.has(key)) linkedBy.set(key, agent);
    }
  }
  const rows = new Map<string, IslandPullRequestRow>();
  for (const entry of entries) {
    const key = pullRequestKey(entry);
    if (rows.has(key)) continue;
    const agent =
      linkedBy.get(key) ??
      // A fork's PR from its own default branch shares the base's name; that's not ours.
      (entry.headBranch === entry.baseBranch
        ? undefined
        : newestFirst.find(
            (candidate) =>
              candidate.environmentId === entry.environmentId &&
              candidate.branch === entry.headBranch,
          ));
    rows.set(key, {
      key,
      environmentId: entry.environmentId,
      projectId: entry.projectId,
      host: entry.host,
      repository: entry.repository,
      number: entry.number,
      title: entry.title,
      url: entry.url,
      state: entry.state,
      isDraft: entry.isDraft,
      headBranch: entry.headBranch,
      author: entry.author?.login ?? null,
      updatedAt: entry.updatedAt,
      agent: agent ?? null,
    });
  }
  for (const agent of newestFirst) {
    for (const link of agent.pullRequests) {
      const key = pullRequestKey(link);
      // Unsynced links have no title or state to show.
      if (link.source === "stack-dismissed" || link.snapshot === null || rows.has(key)) continue;
      const { snapshot } = link;
      rows.set(key, {
        key,
        environmentId: agent.environmentId,
        projectId: agent.projectId,
        host: link.host,
        repository: link.repository,
        number: link.number,
        title: snapshot.title,
        url: link.url,
        state: snapshot.state,
        isDraft: snapshot.isDraft,
        headBranch: snapshot.headBranch,
        author: snapshot.author?.login ?? null,
        updatedAt: snapshot.mergedAt ?? snapshot.closedAt ?? snapshot.updatedAt ?? link.linkedAt,
        agent,
      });
    }
  }
  return [...rows.values()].toSorted(
    (a, b) =>
      Number(b.agent !== null) - Number(a.agent !== null) ||
      Number(b.state === "open") - Number(a.state === "open") ||
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
  );
}
