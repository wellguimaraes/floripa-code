/**
 * The checkout a thread works in, which owns its terminals, browser tabs and
 * right-panel layout. Threads sharing a worktree (or the project's own
 * checkout) share one scope.
 */
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedThreadRef } from "@t3tools/contracts";
import { worktreeScopeKey } from "@t3tools/shared/worktreeScope";
import { useMemo } from "react";

import { useComposerDraftStore } from "./composerDraftStore";
import { setPreviewStateScopeResolver } from "./previewStateStore";
import { setRightPanelScopeResolver } from "./rightPanelStore";
import {
  readEnvironmentSupportsWorktreeSurfaces,
  readProject,
  readThreadShell,
  useProject,
  useThreadShell,
} from "./state/entities";

export interface WorktreeScope {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** Null for the project's own checkout. */
  worktreePath: string | null;
  workspaceRoot: string;
  /** Sent to the server with terminal requests; see `worktreeScopeKey`. */
  scopeKey: string;
  /** Keys client state that every thread in the checkout shares. */
  panelKey: string;
}

export const WORKTREE_PANEL_KEY_PREFIX = "worktree:";

export function worktreePanelKey(environmentId: string, scopeKey: string): string {
  return `${WORKTREE_PANEL_KEY_PREFIX}${environmentId}:${scopeKey}`;
}

function buildScope(input: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  worktreePath: string | null;
  workspaceRoot: string;
}): WorktreeScope {
  const scopeKey = worktreeScopeKey(input);
  return {
    ...input,
    scopeKey,
    panelKey: worktreePanelKey(input.environmentId, scopeKey),
  };
}

function threadLocation(
  ref: ScopedThreadRef,
): { projectId: ProjectId; worktreePath: string | null } | null {
  const shell = readThreadShell(ref);
  if (shell) return { projectId: shell.projectId, worktreePath: shell.worktreePath };
  const draft = useComposerDraftStore.getState().getDraftThreadByRef(ref);
  return draft && !awaitsNewWorktree(draft)
    ? { projectId: draft.projectId, worktreePath: draft.worktreePath }
    : null;
}

/**
 * A draft that will make its own worktree on send has no checkout yet; it keeps
 * its own surfaces rather than borrowing the project folder's.
 */
function awaitsNewWorktree(draft: { envMode: string; worktreePath: string | null }): boolean {
  return draft.envMode === "worktree" && draft.worktreePath === null;
}

/** Null while the thread or its project has not reached this client. */
export function resolveThreadWorktreeScope(ref: ScopedThreadRef): WorktreeScope | null {
  const location = threadLocation(ref);
  if (!location) return null;
  const project = readProject(scopeProjectRef(ref.environmentId, location.projectId));
  if (!project) return null;
  return buildScope({
    environmentId: ref.environmentId,
    projectId: location.projectId,
    worktreePath: location.worktreePath,
    workspaceRoot: project.workspaceRoot,
  });
}

export function useThreadWorktreeScope(ref: ScopedThreadRef | null): WorktreeScope | null {
  const shell = useThreadShell(ref);
  const storedDraft = useComposerDraftStore((store) =>
    ref ? store.getDraftThreadByRef(ref) : null,
  );
  const draft = storedDraft && !awaitsNewWorktree(storedDraft) ? storedDraft : null;
  const projectId = shell?.projectId ?? draft?.projectId ?? null;
  const worktreePath = shell ? shell.worktreePath : (draft?.worktreePath ?? null);
  const project = useProject(
    ref && projectId ? scopeProjectRef(ref.environmentId, projectId) : null,
  );
  const environmentId = ref?.environmentId ?? null;
  const workspaceRoot = project?.workspaceRoot ?? null;
  return useMemo(
    () =>
      environmentId && projectId && workspaceRoot !== null
        ? buildScope({ environmentId, projectId, worktreePath, workspaceRoot })
        : null,
    [environmentId, projectId, worktreePath, workspaceRoot],
  );
}

setRightPanelScopeResolver((ref) => resolveThreadWorktreeScope(ref)?.panelKey ?? null);
// Servers without shared surfaces list each thread's tabs alone, so their tabs stay per thread.
setPreviewStateScopeResolver((ref) => {
  if (!readEnvironmentSupportsWorktreeSurfaces(ref.environmentId)) return null;
  return resolveThreadWorktreeScope(ref);
});
