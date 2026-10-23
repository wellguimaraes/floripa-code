import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, PullRequestListInput, ScopedProjectRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useEffectEvent, useMemo } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { type EnvironmentQueryTarget, usePullRequestList } from "../../state/pullRequests";
import { vcsEnvironment } from "../../state/vcs";
import { countIslandPullRequests, countIslandWorktrees } from "./islandPullRequests";

/** Open PRs read per repository; local-branch PRs are recent, so the newest page is enough. */
const PULL_REQUEST_LIMIT = 100;
/**
 * How often the signs read branches, worktrees and open PRs again: they change outside the app,
 * from a terminal or on the host, and the world keeps these lists open the whole time.
 */
const REFRESH_INTERVAL_MS = 60_000;

export interface BranchTarget {
  readonly island: string;
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  /** The checkout's own folders, which aren't worktrees: the project's and its repository's. */
  readonly roots: ReadonlyArray<string>;
}

export interface IslandSignStats {
  /** Local branches other than the default one. */
  readonly branches: number;
  readonly pullRequests: number;
  readonly worktrees: number;
  /** The island's checkouts, whose branches the counts come from. */
  readonly targets: ReadonlyArray<BranchTarget>;
}

/** A checkout's local branches, read from Git afresh rather than the server's recent snapshot. */
export const branchRefsAtom = (target: BranchTarget) =>
  vcsEnvironment.listRefs({
    environmentId: target.environmentId,
    input: { cwd: target.cwd, refKind: "local", limit: 200, refresh: true },
  });

/**
 * Local branch names per island, across its checkouts and their worktrees, and its worktree
 * count, the main one included. The default branch counts but is left out of the names PRs are
 * matched by: a fork's PR from its own `main` would otherwise count as ours.
 */
const localBranchesAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as ReadonlyArray<BranchTarget>;
    const branches = new Map<string, Set<string>>();
    const branchCounts = new Map<string, Set<string>>();
    const checkouts = targets.map((target) => {
      const refs = Option.getOrNull(AsyncResult.value(get(branchRefsAtom(target))))?.refs ?? [];
      const names = branches.get(target.island) ?? new Set<string>();
      const counted = branchCounts.get(target.island) ?? new Set<string>();
      for (const ref of refs) {
        if (ref.isRemote === true) continue;
        counted.add(ref.name);
        if (!ref.isDefault) names.add(ref.name);
      }
      branches.set(target.island, names);
      branchCounts.set(target.island, counted);
      return {
        island: target.island,
        worktreePaths: refs.map((ref) => (ref.isRemote === true ? null : ref.worktreePath)),
      };
    });
    return { branches, branchCounts, worktrees: countIslandWorktrees(checkouts) };
  }),
);

/** Branch, worktree and open PR counts per island, for the island signs. */
export function useIslandSignStats(
  islands: ReadonlyMap<string, ReadonlyArray<ScopedProjectRef>>,
  projects: ReadonlyArray<EnvironmentProject>,
): ReadonlyMap<string, IslandSignStats> {
  const { listTargets, branchKey } = useMemo(() => {
    const projectOf = new Map(
      projects.map((project) => [
        scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
        project,
      ]),
    );
    const projectIds = new Map<EnvironmentId, Array<ScopedProjectRef["projectId"]>>();
    const branchTargets: Array<BranchTarget> = [];
    for (const [island, members] of islands) {
      for (const member of members) {
        const project = projectOf.get(scopedProjectKey(member));
        if (project === undefined) continue;
        const cwd = project.workspaceRoot;
        // The project can be a folder inside the repo, so its root isn't always the checkout's.
        const repoRoot = project.repositoryIdentity?.rootPath ?? cwd;
        branchTargets.push({
          island,
          environmentId: member.environmentId,
          cwd,
          roots: [cwd, repoRoot],
        });
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
  const { branches, branchCounts, worktrees } = useAtomValue(localBranchesAtom(branchKey));
  const refreshAll = useEffectEvent(() => {
    if (document.hidden) return;
    for (const target of JSON.parse(branchKey) as ReadonlyArray<BranchTarget>) {
      appAtomRegistry.refresh(branchRefsAtom(target));
    }
    pullRequests.refresh();
  });
  useEffect(() => {
    const timer = window.setInterval(refreshAll, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
  return useMemo(() => {
    const pullRequestCounts = countIslandPullRequests(
      islands,
      pullRequests.data?.entries ?? [],
      branches,
    );
    const targets = JSON.parse(branchKey) as ReadonlyArray<BranchTarget>;
    return new Map(
      [...islands.keys()].map((island) => [
        island,
        {
          branches: branchCounts.get(island)?.size ?? 0,
          pullRequests: pullRequestCounts.get(island) ?? 0,
          worktrees: worktrees.get(island) ?? 0,
          targets: targets.filter((target) => target.island === island),
        },
      ]),
    );
  }, [islands, pullRequests.data, branches, branchCounts, worktrees, branchKey]);
}
