/**
 * The workspace value of the project's most recently active thread, among the
 * ones the picker still offers: "local" for the main worktree, else
 * "worktree:<path>". Archived threads and removed worktrees don't count.
 */
export function lastUsedWorkspaceValue(
  threads: ReadonlyArray<{
    readonly worktreePath: string | null;
    readonly updatedAt: string;
    readonly archivedAt: string | null;
  }>,
  offered: ReadonlySet<string>,
): string | null {
  let latest: { readonly value: string; readonly at: number } | null = null;
  for (const thread of threads) {
    if (thread.archivedAt !== null) continue;
    const value = thread.worktreePath === null ? "local" : `worktree:${thread.worktreePath}`;
    const at = Date.parse(thread.updatedAt);
    if (!offered.has(value) || Number.isNaN(at)) continue;
    if (latest === null || at > latest.at) latest = { value, at };
  }
  return latest?.value ?? null;
}
