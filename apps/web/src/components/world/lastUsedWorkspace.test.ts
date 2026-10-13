import { describe, expect, it } from "vite-plus/test";

import { lastUsedWorkspaceValue } from "./lastUsedWorkspace";

const offered = new Set(["local", "new-worktree", "worktree:/repo-a", "worktree:/repo-b"]);
const thread = (
  worktreePath: string | null,
  updatedAt: string,
  archivedAt: string | null = null,
) => ({
  worktreePath,
  updatedAt,
  archivedAt,
});

describe("lastUsedWorkspaceValue", () => {
  it("picks the worktree of the most recently active thread", () => {
    expect(
      lastUsedWorkspaceValue(
        [
          thread("/repo-a", "2026-10-01T00:00:00.000Z"),
          thread("/repo-b", "2026-10-03T00:00:00.000Z"),
          thread(null, "2026-10-02T00:00:00.000Z"),
        ],
        offered,
      ),
    ).toBe("worktree:/repo-b");
  });

  it("picks the main worktree when the latest thread works there", () => {
    expect(
      lastUsedWorkspaceValue(
        [thread("/repo-a", "2026-10-01T00:00:00.000Z"), thread(null, "2026-10-02T00:00:00.000Z")],
        offered,
      ),
    ).toBe("local");
  });

  it("skips archived threads and worktrees no longer offered", () => {
    expect(
      lastUsedWorkspaceValue(
        [
          thread("/repo-a", "2026-10-01T00:00:00.000Z"),
          thread("/repo-b", "2026-10-03T00:00:00.000Z", "2026-10-04T00:00:00.000Z"),
          thread("/removed", "2026-10-05T00:00:00.000Z"),
        ],
        offered,
      ),
    ).toBe("worktree:/repo-a");
  });

  it("is null without threads", () => {
    expect(lastUsedWorkspaceValue([], offered)).toBeNull();
  });
});
