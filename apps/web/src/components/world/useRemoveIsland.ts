import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate, useParams } from "@tanstack/react-router";

import { useComposerDraftStore } from "../../composerDraftStore";
import { releaseProjectDraftUploads } from "../../lib/composerDraftUploads";
import { readLocalApi } from "../../localApi";
import { readThreadShells } from "../../state/entities";
import { projectEnvironment } from "../../state/projects";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { toastManager } from "../ui/toast";

/**
 * Removes every checkout on an island after a confirmation, as Settings removes a
 * project group: the project entries and their threads go, the files on disk stay.
 * Callers gate on `canChangeIslandIcon`, the same operate scope on every checkout.
 */
export function useRemoveIsland() {
  const deleteProject = useOrchestrationCommand(projectEnvironment.delete, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  return async (checkouts: ReadonlyArray<EnvironmentProject>, projectName: string) => {
    const api = readLocalApi();
    if (api === undefined || checkouts.length === 0) return;
    const checkoutKeys = new Set(checkouts.map((c) => `${c.environmentId}:${c.id}`));
    const threads = readThreadShells().filter((thread) =>
      checkoutKeys.has(`${thread.environmentId}:${thread.projectId}`),
    );
    const confirmed = await api.dialogs
      .confirm(
        [
          threads.length > 0
            ? `Remove project "${projectName}" and delete its ${threads.length} thread${threads.length === 1 ? "" : "s"}?`
            : `Remove project "${projectName}"?`,
          checkouts.length > 1
            ? `This removes its ${checkouts.length} checkouts.`
            : `Path: ${checkouts[0]!.workspaceRoot}`,
          ...(threads.length > 0
            ? [
                "This permanently clears conversation history for those threads and any archived threads.",
              ]
            : []),
          "This removes only the project entries, not the files on disk.",
          "This action cannot be undone.",
        ].join("\n"),
        { variant: "destructive" },
      )
      .catch(() => false);
    if (!confirmed) return;

    // The open chat goes with its project, so close it first.
    if (
      threads.some(
        (thread) => thread.environmentId === params.environmentId && thread.id === params.threadId,
      )
    ) {
      void navigate({ to: "/", replace: true });
    }
    const draftStore = useComposerDraftStore.getState();
    for (const checkout of checkouts) {
      const result = await deleteProject({
        environmentId: checkout.environmentId,
        input: { projectId: checkout.id, force: true },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: `Could not remove "${projectName}"`,
          description: error instanceof Error ? error.message : undefined,
        });
        return;
      }
      const projectRef = scopeProjectRef(checkout.environmentId, checkout.id);
      releaseProjectDraftUploads(
        projectRef,
        threads
          .filter(
            (thread) =>
              thread.environmentId === checkout.environmentId && thread.projectId === checkout.id,
          )
          .map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
      );
      const draft = draftStore.getDraftThreadByProjectRef(projectRef);
      if (draft) draftStore.clearDraftThread(draft.draftId);
      draftStore.clearProjectDraftThreadId(projectRef);
    }
  };
}
