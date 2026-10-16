/**
 * Terminals and browser tabs belong to a checkout, not to a thread: every
 * thread working in the same worktree (or in the project's own checkout when
 * it has no worktree) shares them. Server, web, and mobile all derive the key
 * here so a surface opened by one of them is found by the others.
 */
export function worktreeScopeKey(input: {
  worktreePath?: string | null | undefined;
  workspaceRoot: string;
}): string {
  const path = input.worktreePath?.trim() || input.workspaceRoot.trim();
  const stripped = path.replace(/[\\/]+$/, "");
  return stripped === "" ? path : stripped;
}
