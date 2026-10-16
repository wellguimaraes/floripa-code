/**
 * Terminals live in the right panel's Terminal type, shared by every thread
 * in a checkout. These helpers answer "is a terminal on screen" for shortcut
 * contexts and "could another thread allocate the same id" for new terminals.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import { worktreeScopeKey } from "@t3tools/shared/worktreeScope";

import {
  selectActiveRightPanelType,
  selectThreadRightPanelState,
  type ThreadRightPanelState,
} from "./rightPanelStore";
import { readThreadShells } from "./state/entities";
import type { WorktreeScope } from "./worktreeScope";

/** The `terminalOpen` shortcut context: the thread's panel is open on the Terminal type. */
export function selectTerminalPanelOpen(
  byPanelKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  if (!ref) return false;
  const state = selectThreadRightPanelState(byPanelKey, ref);
  return state.isOpen && selectActiveRightPanelType(state) === "terminal";
}

/**
 * Whether another thread works in the same checkout. Read once when allocating
 * a terminal id, so it subscribes to nothing.
 */
export function isWorktreeScopeShared(scope: WorktreeScope, ref: ScopedThreadRef): boolean {
  return readThreadShells().some(
    (shell) =>
      shell.environmentId === scope.environmentId &&
      shell.projectId === scope.projectId &&
      shell.id !== ref.threadId &&
      worktreeScopeKey({ worktreePath: shell.worktreePath, workspaceRoot: scope.workspaceRoot }) ===
        scope.scopeKey,
  );
}
