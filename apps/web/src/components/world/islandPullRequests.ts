import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";

import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";

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
  const islandOf = new Map<string, string>();
  for (const [island, members] of islands) {
    for (const member of members) islandOf.set(scopedProjectKey(member), island);
  }
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const island = islandOf.get(
      scopedProjectKey({ environmentId: entry.environmentId, projectId: entry.projectId }),
    );
    if (island === undefined || !branchesOf.get(island)?.has(entry.headBranch)) continue;
    // Two environments holding the same repository both list its PRs.
    const id = `${island} ${entry.host} ${entry.repository} ${entry.number}`;
    if (seen.has(id)) continue;
    seen.add(id);
    counts.set(island, (counts.get(island) ?? 0) + 1);
  }
  return counts;
}
