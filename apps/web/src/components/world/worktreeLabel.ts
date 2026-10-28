import { fileBasename } from "@t3tools/shared/path";

/**
 * How the world names where a thread works. Worktree folders are often generated
 * (e.g. `t3-8f432bc3`), so a worktree goes by its branch.
 */
export function worktreeLabel(thread: {
  readonly worktreePath: string | null;
  readonly branch: string | null;
}): string {
  if (thread.worktreePath === null) return "Main worktree";
  return thread.branch ?? fileBasename(thread.worktreePath);
}
