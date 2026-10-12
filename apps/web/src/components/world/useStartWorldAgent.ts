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
import { useCallback, useEffect, useState } from "react";

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
import { readProjects } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
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
 * are checked out somewhere other than the project checkout. Until git answers,
 * the project counts as a repo so the picker shows right away.
 */
export function useWorldAgentWorkspaces(projectRef: ScopedProjectRef) {
  const listRefs = useAtomQueryRunner(vcsEnvironment.listRefs, {
    reportFailure: false,
    refresh: true,
  });
  const { environmentId, projectId } = projectRef;
  const [state, setState] = useState<{
    readonly defaultWorkspace: WorldAgentWorkspace;
    readonly worktrees: ReadonlyArray<{ readonly path: string; readonly branch: string }>;
    readonly isRepo: boolean;
  }>({ defaultWorkspace: { kind: "local" }, worktrees: [], isRepo: true });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const project = findProject({ environmentId, projectId });
      const [projectSettings, refs] = await Promise.all([
        readProjectSettings(environmentId, project),
        listRefs({
          environmentId,
          input: { cwd: project.workspaceRoot, refKind: "local", limit: 200 },
        }),
      ]);
      if (cancelled) return;
      const isRepo = refs._tag === "Success" && refs.value.isRepo;
      const worktrees =
        refs._tag === "Success"
          ? refs.value.refs.flatMap((ref) =>
              ref.worktreePath !== null && ref.worktreePath !== project.workspaceRoot
                ? [{ path: ref.worktreePath, branch: ref.name }]
                : [],
            )
          : [];
      setState({
        defaultWorkspace:
          isRepo && projectSettings.defaultThreadEnvMode === "worktree"
            ? { kind: "new-worktree" }
            : { kind: "local" },
        worktrees,
        isRepo,
      });
    })().catch((error: unknown) => {
      console.warn("Could not list the project's worktrees.", error);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, listRefs, projectId]);

  return state;
}

/**
 * Starts a thread in a project straight away, without opening its draft. It
 * picks what a fresh draft would: the project's default model or the last one
 * used, and its permissions. It works in the given workspace, else the
 * project's local-or-worktree default, basing a new worktree on the repo's
 * default branch like the branch picker does.
 */
export function useStartWorldAgent() {
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const listRefs = useAtomQueryRunner(vcsEnvironment.listRefs, {
    reportFailure: false,
    refresh: true,
  });

  return useCallback(
    async (
      projectRef: ScopedProjectRef,
      text: string,
      attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment> = [],
      workspace: WorldAgentWorkspace | null = null,
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

      let baseBranch: string | null = null;
      if (workspaceKind === "new-worktree") {
        const refs = await listRefs({
          environmentId,
          input: { cwd: project.workspaceRoot, limit: 100 },
        });
        if (refs._tag === "Success") {
          baseBranch =
            refs.value.refs.find((ref) => ref.isDefault)?.name ??
            refs.value.refs.find((ref) => ref.current)?.name ??
            null;
        }
        if (baseBranch === null)
          throw new Error("Could not find a branch to base the worktree on.");
      }

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
    [listRefs, startTurn],
  );
}
