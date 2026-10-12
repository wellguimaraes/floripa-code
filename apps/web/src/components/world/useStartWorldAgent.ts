import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  type ChatAttachment,
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ScopedProjectRef,
  type ThreadId,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { getClientSettings, mergeEnvironmentSettings } from "../../hooks/useSettings";
import { newMessageId, newThreadId } from "../../lib/utils";
import { readT3ProjectFile } from "../../lib/t3ProjectFileDefaults";
import { resolveAppModelSelectionForInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { getDefaultServerModel } from "../../providerModels";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readProjects, useProject } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useEnvironmentQuery } from "../../state/query";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { vcsEnvironment } from "../../state/vcs";
import { resolveComposerProviderSelection } from "../ChatView.logic";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../chat/composerPromptHistory";

/** Where a new agent works: the project checkout, a new worktree, or an existing one. */
export type WorldAgentWorkspace =
  | { readonly kind: "local" }
  | { readonly kind: "new-worktree" }
  | { readonly kind: "worktree"; readonly path: string; readonly branch: string };

function findProject(projectRef: ScopedProjectRef) {
  const project = readProjects().find(
    (candidate) =>
      candidate.id === projectRef.projectId && candidate.environmentId === projectRef.environmentId,
  );
  if (project === undefined) throw new Error("This project is no longer available.");
  return project;
}

/** The project's settings, reading its project file when it leaves the workspace mode unset. */
async function readProjectSettings(
  environmentId: EnvironmentId,
  project: ReturnType<typeof findProject>,
) {
  const serverConfig = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  const serverSettings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
  const settings = resolveProjectSettings(serverSettings, project.id, project).settings;
  if (settings.defaultThreadEnvMode !== null) return settings;
  const projectFile = await readT3ProjectFile(environmentId, project.workspaceRoot);
  return resolveProjectSettings(serverSettings, project.id, project, projectFile).settings;
}

/**
 * The workspaces a new agent in a project can pick from, and the one a fresh
 * draft would use. Existing worktrees come from the repo's local branches that
 * are checked out somewhere other than the project checkout; a new worktree
 * starts from the default branch, else the current one. Until git answers,
 * the project counts as a repo so the picker shows right away.
 */
export function useWorldAgentWorkspaces(projectRef: ScopedProjectRef) {
  const { environmentId, projectId } = projectRef;
  const workspaceRoot = useProject(projectRef)?.workspaceRoot ?? null;
  // A live query, not a one-shot read: ref lists are streams that stay open,
  // so awaiting a settled result would never resolve.
  const refsAtom = useMemo(
    () =>
      workspaceRoot === null
        ? null
        : vcsEnvironment.listRefs({
            environmentId,
            input: { cwd: workspaceRoot, limit: 200 },
          }),
    [environmentId, workspaceRoot],
  );
  const refs = useEnvironmentQuery(refsAtom);
  const isRepo = refs.failure === null && (refs.data?.isRepo ?? true);
  const worktrees = useMemo(
    () =>
      (refs.data?.refs ?? []).flatMap((ref) =>
        ref.isRemote !== true && ref.worktreePath !== null && ref.worktreePath !== workspaceRoot
          ? [{ path: ref.worktreePath, branch: ref.name }]
          : [],
      ),
    [refs.data, workspaceRoot],
  );
  // The server lists the current and default branches first.
  const worktreeBaseBranch =
    refs.data?.refs.find((ref) => ref.isDefault)?.name ??
    refs.data?.refs.find((ref) => ref.current)?.name ??
    null;

  const [worktreeByDefault, setWorktreeByDefault] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const project = findProject({ environmentId, projectId });
      const projectSettings = await readProjectSettings(environmentId, project);
      if (!cancelled) setWorktreeByDefault(projectSettings.defaultThreadEnvMode === "worktree");
    })().catch((error: unknown) => {
      console.warn("Could not read the project's workspace default.", error);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, projectId]);

  const defaultWorkspace: WorldAgentWorkspace =
    isRepo && worktreeByDefault ? { kind: "new-worktree" } : { kind: "local" };
  return { defaultWorkspace, worktrees, worktreeBaseBranch, isRepo };
}

/**
 * Starts a thread in a project straight away, without opening its draft. It
 * picks what a fresh draft would: the project's default model or the last one
 * used, and its permissions. It works in the given workspace, else the
 * project's local-or-worktree default. A new worktree starts from the given
 * base branch, which useWorldAgentWorkspaces finds like the branch picker does.
 */
export function useStartWorldAgent() {
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return useCallback(
    async (
      projectRef: ScopedProjectRef,
      text: string,
      attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment> = [],
      workspace: WorldAgentWorkspace | null = null,
      worktreeBaseBranch: string | null = null,
    ): Promise<ThreadId> => {
      const { environmentId } = projectRef;
      const project = findProject(projectRef);
      const serverConfig = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
      const serverSettings = serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS;
      const settings = mergeEnvironmentSettings(serverSettings, getClientSettings());
      const providers = serverConfig?.providers ?? [];
      const projectSettings = await readProjectSettings(environmentId, project);
      const workspaceKind =
        workspace?.kind ??
        (projectSettings.defaultThreadEnvMode === "worktree" ? "new-worktree" : "local");

      const { stickyActiveProvider, stickyModelSelectionByProvider } =
        useComposerDraftStore.getState();
      const preferred: ModelSelection | null =
        projectSettings.defaultModelSelection ??
        (stickyActiveProvider
          ? (stickyModelSelectionByProvider[stickyActiveProvider] ?? null)
          : null);
      const { selectedProviderEntry: provider } = resolveComposerProviderSelection({
        entries: sortProviderInstanceEntries(
          applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
        ),
        candidateInstanceIds: [preferred?.instanceId],
        lockedProvider: null,
        lockedInstanceId: null,
      });
      if (provider === undefined) throw new Error("No agent provider is available.");
      const keepsPreferred = preferred?.instanceId === provider.instanceId;
      const modelSelection = createModelSelection(
        provider.instanceId,
        resolveAppModelSelectionForInstance(
          provider.instanceId,
          settings,
          providers,
          keepsPreferred ? preferred.model : null,
        ) ?? getDefaultServerModel(providers, provider.driverKind),
        keepsPreferred ? preferred.options : null,
      );
      const supportedRuntimeModes = provider.snapshot.supportedRuntimeModes ?? [];
      const runtimeMode =
        supportedRuntimeModes.length === 0 ||
        supportedRuntimeModes.includes(projectSettings.defaultRuntimeMode)
          ? projectSettings.defaultRuntimeMode
          : supportedRuntimeModes[0]!;

      const baseBranch = workspaceKind === "new-worktree" ? worktreeBaseBranch : null;
      if (workspaceKind === "new-worktree" && baseBranch === null)
        throw new Error("Could not find a branch to base the worktree on.");

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      // Named like the chat composer names it: the text, else the first image or file.
      const firstFile = attachments.find((attachment) => attachment.type === "file");
      const title = deriveThreadTitleSeed({
        text,
        attachments: attachments.filter((attachment) => attachment.type === "image"),
        fallbackLabels: [firstFile && `File: ${firstFile.name}`],
      });
      const interactionMode = "default" as const;
      const result = await startTurn({
        environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
            attachments: [...attachments],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode,
          bootstrap: {
            createThread: {
              projectId: project.id,
              title,
              modelSelection,
              runtimeMode,
              interactionMode,
              branch: workspace?.kind === "worktree" ? workspace.branch : baseBranch,
              worktreePath: workspace?.kind === "worktree" ? workspace.path : null,
              createdAt,
            },
            ...(baseBranch !== null
              ? {
                  prepareWorktree: {
                    projectCwd: project.workspaceRoot,
                    baseBranch,
                    ...(projectSettings.newWorktreesStartFromOrigin
                      ? { startFromOrigin: true }
                      : {}),
                  },
                  runSetupScript: true,
                }
              : {}),
          },
          createdAt,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return threadId;
    },
    [startTurn],
  );
}
