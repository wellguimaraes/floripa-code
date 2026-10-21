import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import { countIslandPullRequests, countIslandWorktrees } from "./islandPullRequests";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;
const ref = (environmentId: EnvironmentId, projectId: string) => ({
  environmentId,
  projectId: projectId as ProjectId,
});
const entry = (
  environmentId: EnvironmentId,
  projectId: string,
  number: number,
  headBranch: string,
) =>
  ({
    environmentId,
    projectId: projectId as ProjectId,
    host: "github.com",
    repository: "acme/app",
    number,
    headBranch,
  }) as EnvironmentPullRequestEntry;

describe("countIslandPullRequests", () => {
  it("counts PRs whose head is a branch on any checkout of the island", () => {
    const islands = new Map([["app", [ref(local, "main-clone"), ref(local, "second-clone")]]]);
    // The server lists the repository once, under the first clone.
    const entries = [
      entry(local, "main-clone", 1, "feat/a"),
      entry(local, "main-clone", 2, "feat/b"),
      entry(local, "main-clone", 3, "someone-else"),
    ];
    const branches = new Map([["app", new Set(["feat/a", "feat/b"])]]);
    expect(countIslandPullRequests(islands, entries, branches).get("app")).toBe(2);
  });

  it("counts a PR once when two environments list the same repository", () => {
    const islands = new Map([["app", [ref(local, "p1"), ref(remote, "p2")]]]);
    const entries = [entry(local, "p1", 7, "feat/a"), entry(remote, "p2", 7, "feat/a")];
    const branches = new Map([["app", new Set(["feat/a"])]]);
    expect(countIslandPullRequests(islands, entries, branches).get("app")).toBe(1);
  });

  it("leaves islands without matching branches out", () => {
    const islands = new Map([["app", [ref(local, "p1")]]]);
    const entries = [entry(local, "p1", 1, "feat/a"), entry(local, "unknown", 2, "feat/a")];
    expect(countIslandPullRequests(islands, entries, new Map()).has("app")).toBe(false);
  });
});

describe("countIslandWorktrees", () => {
  it("counts worktrees once across checkouts, the main one included", () => {
    const counts = countIslandWorktrees([
      { island: "app", worktreePaths: ["/repo", "/repo/.worktrees/feature", null] },
      // A second project in the same repository lists the same worktrees.
      { island: "app", worktreePaths: ["/repo", "/repo/.worktrees/feature"] },
      { island: "site", worktreePaths: ["/site"] },
      { island: "empty", worktreePaths: [null] },
    ]);
    expect(counts.get("app")).toBe(2);
    expect(counts.get("site")).toBe(1);
    expect(counts.get("empty")).toBe(0);
  });
});
