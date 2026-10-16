/**
 * The existing worktrees, the one whose latest thread was active most recently
 * first. Archived threads don't count; worktrees no thread used keep their order
 * after the rest.
 */
export function worktreesByRecency<Worktree extends { readonly path: string }>(
  worktrees: ReadonlyArray<Worktree>,
  threads: ReadonlyArray<{
    readonly worktreePath: string | null;
    readonly updatedAt: string;
    readonly archivedAt: string | null;
  }>,
): ReadonlyArray<Worktree> {
  const lastUsed = new Map<string, number>();
  for (const thread of threads) {
    if (thread.archivedAt !== null || thread.worktreePath === null) continue;
    const at = Date.parse(thread.updatedAt);
    if (Number.isNaN(at)) continue;
    lastUsed.set(thread.worktreePath, Math.max(at, lastUsed.get(thread.worktreePath) ?? at));
  }
  // A stable sort, so unused worktrees stay in git's order.
  return worktrees.toSorted((a, b) => (lastUsed.get(b.path) ?? 0) - (lastUsed.get(a.path) ?? 0));
}
