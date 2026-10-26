import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, PullRequestListInput, ScopedProjectRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { type EnvironmentQueryTarget, usePullRequestList } from "../../state/pullRequests";
import { vcsEnvironment } from "../../state/vcs";
import { countIslandPullRequests } from "./islandPullRequests";
import { type IslandPrefs, islandStaleDays } from "./worldIslandPrefsStore";

/** Open PRs read per repository; local-branch PRs are recent, so the newest page is enough. */
const PULL_REQUEST_LIMIT = 100;
/**
 * How often the signs read branches and open PRs again: they change outside the app,
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
  /** Branches last committed to longer ago than the island's stale threshold. */
  readonly staleBranches: number;
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
 * Local branch names per island, across its checkouts and their worktrees. The default branch
 * counts but is left out of the names PRs are matched by: a fork's PR from its own `main` would
 * otherwise count as ours. Also when each branch, the default one aside, was last committed to.
 */
const localBranchesAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as ReadonlyArray<BranchTarget>;
    const branches = new Map<string, Set<string>>();
    const branchCounts = new Map<string, Set<string>>();
    const lastCommits = new Map<string, Map<string, string | null>>();
    for (const target of targets) {
      const refs = Option.getOrNull(AsyncResult.value(get(branchRefsAtom(target))))?.refs ?? [];
      const names = branches.get(target.island) ?? new Set<string>();
      const counted = branchCounts.get(target.island) ?? new Set<string>();
      const commits = lastCommits.get(target.island) ?? new Map<string, string | null>();
      for (const ref of refs) {
        if (ref.isRemote === true) continue;
        counted.add(ref.name);
        if (ref.isDefault) continue;
        names.add(ref.name);
        commits.set(ref.name, ref.lastCommitAt ?? null);
      }
      branches.set(target.island, names);
      branchCounts.set(target.island, counted);
      lastCommits.set(target.island, commits);
    }
    return { branches, branchCounts, lastCommits };
  }),
);

/** Branch and open PR counts per island, for the island signs. */
export function useIslandSignStats(
  islands: ReadonlyMap<string, ReadonlyArray<ScopedProjectRef>>,
  projects: ReadonlyArray<EnvironmentProject>,
  prefs: Readonly<Record<string, IslandPrefs>>,
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
  const { branches, branchCounts, lastCommits } = useAtomValue(localBranchesAtom(branchKey));
  // When the counts were last read, which staleness is judged against.
  const [now, setNow] = useState(Date.now);
  const refreshAll = useEffectEvent(() => {
    if (document.hidden) return;
    setNow(Date.now());
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
      [...islands.keys()].map((island) => {
        const staleDays = islandStaleDays(prefs[island]);
        const commits = [...(lastCommits.get(island)?.values() ?? [])];
        return [
          island,
          {
            branches: branchCounts.get(island)?.size ?? 0,
            pullRequests: pullRequestCounts.get(island) ?? 0,
            staleBranches:
              staleDays === null ? 0 : commits.filter((at) => isStale(at, staleDays, now)).length,
            targets: targets.filter((target) => target.island === island),
          },
        ];
      }),
    );
  }, [islands, pullRequests.data, branches, branchCounts, lastCommits, branchKey, prefs, now]);
}

/** Whether a branch last committed to at `lastCommitAt` is older than `staleDays`. */
export function isStale(lastCommitAt: string | null, staleDays: number, now: number): boolean {
  if (lastCommitAt === null) return false;
  const at = Date.parse(lastCommitAt);
  return !Number.isNaN(at) && now - at > staleDays * 24 * 60 * 60_000;
}
