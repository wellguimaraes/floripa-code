import type { EnvironmentId, ProjectId, ThreadId, ThreadPullRequestLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentPullRequestEntry } from "../pullRequest/pullRequestList.logic";
import {
  countIslandPullRequests,
  type IslandPullRequestAgent,
  listIslandPullRequests,
  ownIslandPullRequests,
} from "./islandPullRequests";

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
    baseBranch: "main",
    title: `PR ${number}`,
    url: `https://github.com/acme/app/pull/${number}`,
    state: "open",
    isDraft: false,
    author: null,
    updatedAt: `2026-10-0${number}T00:00:00.000Z`,
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

const agent = (
  id: string,
  branch: string | null,
  updatedAt: string,
  pullRequests: ReadonlyArray<ThreadPullRequestLink> = [],
): IslandPullRequestAgent => ({
  environmentId: local,
  id: id as ThreadId,
  projectId: "p1" as ProjectId,
  branch,
  worktreePath: null,
  updatedAt,
  pullRequests,
});
const link = (
  number: number,
  state: "open" | "merged" | "closed",
  source: ThreadPullRequestLink["source"] = "created",
) =>
  ({
    host: "github.com",
    repository: "acme/app",
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    source,
    linkedAt: "2026-09-01T00:00:00.000Z",
    snapshot: {
      state,
      title: `Linked ${number}`,
      headBranch: `feat/${number}`,
      baseBranch: "main",
      isDraft: false,
      updatedAt: "2026-09-02T00:00:00.000Z",
      syncedAt: "2026-09-02T00:00:00.000Z",
    },
    stack: null,
  }) as ThreadPullRequestLink;

describe("listIslandPullRequests", () => {
  it("lists every open PR, adds agents' merged ones, and leads with those an agent works on", () => {
    const rows = listIslandPullRequests(
      [entry(local, "p1", 1, "someone-else"), entry(local, "p1", 2, "feat/b")],
      [
        agent("t1", "feat/b", "2026-10-10"),
        agent("t2", "feat/9", "2026-10-09", [link(9, "merged")]),
      ],
    );
    expect(rows.map((row) => [row.number, row.state, row.agent?.id ?? null])).toEqual([
      [2, "open", "t1"],
      [9, "merged", "t2"],
      [1, "open", null],
    ]);
  });

  it("matches a link before a branch, and the newest agent first", () => {
    const rows = listIslandPullRequests(
      [entry(local, "p1", 3, "feat/c")],
      [
        agent("older", "feat/c", "2026-10-01"),
        agent("newer", "feat/c", "2026-10-05"),
        agent("linker", "other", "2026-09-01", [link(3, "open", "manual")]),
      ],
    );
    expect(rows.map((row) => row.agent?.id)).toEqual(["linker"]);
    expect(
      listIslandPullRequests(
        [entry(local, "p1", 3, "feat/c")],
        [agent("older", "feat/c", "2026-10-01"), agent("newer", "feat/c", "2026-10-05")],
      )[0]?.agent?.id,
    ).toBe("newer");
  });

  it("skips dismissed and unsynced links, and fork PRs from the default branch", () => {
    const unsynced = { ...link(5, "closed"), snapshot: null };
    const rows = listIslandPullRequests(
      [entry(local, "p1", 4, "main")],
      [agent("t1", "main", "2026-10-01", [link(6, "closed", "stack-dismissed"), unsynced])],
    );
    expect(rows.map((row) => [row.number, row.agent])).toEqual([[4, null]]);
  });
});

describe("ownIslandPullRequests", () => {
  it("keeps the viewer's PRs and those from local branches", () => {
    const by = (number: number, headBranch: string, login: string) =>
      ({
        ...entry(local, "p1", number, headBranch),
        author: { login },
      }) as EnvironmentPullRequestEntry;
    const entries = [
      by(1, "feat/mine-elsewhere", "Me"),
      by(2, "feat/local", "teammate"),
      by(3, "feat/theirs", "teammate"),
    ];
    const viewers = { [`${local} github.com`]: "me" };
    expect(
      ownIslandPullRequests(entries, viewers, new Set(["feat/local"])).map((e) => e.number),
    ).toEqual([1, 2]);
  });
});
