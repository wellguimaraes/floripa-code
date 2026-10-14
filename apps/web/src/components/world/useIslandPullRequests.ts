import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, PullRequestListInput, ScopedProjectRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useMemo } from "react";

import { type EnvironmentQueryTarget, usePullRequestList } from "../../state/pullRequests";
import { vcsEnvironment } from "../../state/vcs";
import { countIslandPullRequests } from "./islandPullRequests";

/** Open PRs read per repository; local-branch PRs are recent, so the newest page is enough. */
const PULL_REQUEST_LIMIT = 100;

interface BranchTarget {
  readonly island: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
}

/**
 * Local branch names per island, across its checkouts and their worktrees. The default branch
 * is left out: a fork's PR from its own `main` would otherwise count as ours.
 */
const localBranchesAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as ReadonlyArray<BranchTarget>;
    const branches = new Map<string, Set<string>>();
    for (const target of targets) {
      const result = get(
        vcsEnvironment.listRefs({
          environmentId: target.environmentId,
          input: { cwd: target.cwd, refKind: "local", limit: 200 },
        }),
      );
      const names = branches.get(target.island) ?? new Set<string>();
      for (const ref of Option.getOrNull(AsyncResult.value(result))?.refs ?? []) {
        if (ref.isRemote !== true && !ref.isDefault) names.add(ref.name);
      }
      branches.set(target.island, names);
    }
    return branches;
  }),
);

/** Open PR counts per island, for the island signs. */
export function useIslandPullRequests(
  islands: ReadonlyMap<string, ReadonlyArray<ScopedProjectRef>>,
  projects: ReadonlyArray<EnvironmentProject>,
): ReadonlyMap<string, number> {
  const { listTargets, branchKey } = useMemo(() => {
    const rootOf = new Map(
      projects.map((project) => [
        scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
        project.workspaceRoot,
      ]),
    );
    const projectIds = new Map<EnvironmentId, Array<ScopedProjectRef["projectId"]>>();
    const branchTargets: Array<BranchTarget> = [];
    for (const [island, members] of islands) {
      for (const member of members) {
        const cwd = rootOf.get(scopedProjectKey(member));
        if (cwd === undefined) continue;
        branchTargets.push({ island, environmentId: member.environmentId, cwd });
        projectIds.set(member.environmentId, [
          ...(projectIds.get(member.environmentId) ?? []),
          member.projectId,
        ]);
      }
    }
    const listTargets: Array<EnvironmentQueryTarget<PullRequestListInput>> = [...projectIds].map(
      ([environmentId, ids]) => ({
        environmentId,
        input: { state: "open", projectIds: ids, limit: PULL_REQUEST_LIMIT },
      }),
    );
    return { listTargets, branchKey: JSON.stringify(branchTargets) };
  }, [islands, projects]);

  const pullRequests = usePullRequestList(listTargets);
  const branches = useAtomValue(localBranchesAtom(branchKey));
  return useMemo(
    () => countIslandPullRequests(islands, pullRequests.data?.entries ?? [], branches),
    [islands, pullRequests.data, branches],
  );
}
