import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";

type ChatShell = Pick<
  EnvironmentThreadShell,
  "environmentId" | "projectId" | "worktreePath" | "archivedAt"
>;

/**
 * The chat to show once the open one is archived: the one opened most recently before it that
 * still works in the same worktree and is not archived. `null` means the chat closes.
 * `opened` runs oldest first. A thread in its project's folder has no worktree path, so
 * `readFolder` gives that folder, and one recorded with the folder's path matches it too.
 */
export function chatAfterArchive(
  opened: ReadonlyArray<ScopedThreadRef>,
  archived: ScopedThreadRef,
  readShell: (ref: ScopedThreadRef) => ChatShell | null,
  readFolder: (shell: ChatShell) => string | null,
): ScopedThreadRef | null {
  const gone = readShell(archived);
  if (gone === null) return null;
  const placeOf = (shell: ChatShell) =>
    `${shell.environmentId}\u0000${shell.worktreePath ?? readFolder(shell)}`;
  const place = placeOf(gone);
  const archivedKey = scopedThreadKey(archived);
  for (let index = opened.length - 1; index >= 0; index -= 1) {
    const ref = opened[index]!;
    if (scopedThreadKey(ref) === archivedKey) continue;
    const shell = readShell(ref);
    if (shell !== null && shell.archivedAt == null && placeOf(shell) === place) return ref;
  }
  return null;
}
