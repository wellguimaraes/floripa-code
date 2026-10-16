import { describe, expect, it } from "vite-plus/test";

import { worktreesByRecency } from "./worktreesByRecency";

const worktrees = [{ path: "/repo-a" }, { path: "/repo-b" }, { path: "/repo-c" }];
const thread = (
  worktreePath: string | null,
  updatedAt: string,
  archivedAt: string | null = null,
) => ({
  worktreePath,
  updatedAt,
  archivedAt,
});
const paths = (sorted: ReadonlyArray<{ readonly path: string }>) => sorted.map((item) => item.path);

describe("worktreesByRecency", () => {
  it("puts the worktree with the most recently active thread first", () => {
    expect(
      paths(
        worktreesByRecency(worktrees, [
          thread("/repo-a", "2026-10-01T00:00:00.000Z"),
          thread("/repo-b", "2026-10-03T00:00:00.000Z"),
          thread("/repo-a", "2026-10-02T00:00:00.000Z"),
          thread(null, "2026-10-05T00:00:00.000Z"),
        ]),
      ),
    ).toEqual(["/repo-b", "/repo-a", "/repo-c"]);
  });

  it("skips archived threads and keeps unused worktrees in order", () => {
    expect(
      paths(
        worktreesByRecency(worktrees, [
          thread("/repo-b", "2026-10-03T00:00:00.000Z", "2026-10-04T00:00:00.000Z"),
          thread("/repo-c", "2026-10-01T00:00:00.000Z"),
        ]),
      ),
    ).toEqual(["/repo-c", "/repo-a", "/repo-b"]);
  });

  it("keeps git's order without threads", () => {
    expect(paths(worktreesByRecency(worktrees, []))).toEqual(["/repo-a", "/repo-b", "/repo-c"]);
  });
});
