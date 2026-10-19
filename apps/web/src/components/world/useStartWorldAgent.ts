import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ScopedProjectRef,
  type ServerProvider,
  type ThreadId,
  type UnifiedSettings,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import {
  getClientSettings,
  mergeEnvironmentSettings,
  useEnvironmentSettings,
} from "../../hooks/useSettings";
import { stripInlineContextReferences } from "../../lib/composerContextReferences";
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
import { readProjects, useProject, useServerConfigs } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useEnvironmentQuery } from "../../state/query";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { vcsEnvironment } from "../../state/vcs";
import {
  resolveComposerInteractionMode,
  resolveComposerProviderSelection,
} from "../ChatView.logic";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../chat/composerPromptHistory";
import type { OutgoingMessage } from "./useBubbleAttachments";

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

type ProjectSettings = Awaited<ReturnType<typeof readProjectSettings>>;

/** The project's settings, null until read. */
function useProjectSettings(projectRef: ScopedProjectRef) {
  const { environmentId, projectId } = projectRef;
  const [projectSettings, setProjectSettings] = useState<ProjectSettings | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const project = findProject({ environmentId, projectId });
      const settings = await readProjectSettings(environmentId, project);
      if (!cancelled) setProjectSettings(settings);
    })().catch((error: unknown) => {
      console.warn("Could not read the project's settings.", error);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, projectId]);
  return projectSettings;
}

/** What a new agent runs with: the model and its options, permissions, and plan or build. */
export interface WorldAgentSetup {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

/**
 * The setup a fresh draft would pick: the project's default model or the last
 * one used, and the project's permissions where the provider supports them.
 */
function resolveWorldAgentSetup(
  providers: ReadonlyArray<ServerProvider>,
  settings: UnifiedSettings,
  projectSettings: ProjectSettings,
): WorldAgentSetup | null {
  const { stickyActiveProvider, stickyModelSelectionByProvider } = useComposerDraftStore.getState();
  const preferred: ModelSelection | null =
    projectSettings.defaultModelSelection ??
    (stickyActiveProvider ? (stickyModelSelectionByProvider[stickyActiveProvider] ?? null) : null);
  const { selectedProviderEntry: provider } = resolveComposerProviderSelection({
    entries: sortProviderInstanceEntries(
      applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
    ),
    candidateInstanceIds: [preferred?.instanceId],
    lockedProvider: null,
    lockedInstanceId: null,
  });
  if (provider === undefined) return null;
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
  return { modelSelection, runtimeMode, interactionMode: "default" };
}

/**
 * The setup a new agent in a project starts with, for the bubble's pickers to
 * show and change. Null until the project's settings are read, or when no
 * provider is available.
 */
export function useWorldAgentSetup(projectRef: ScopedProjectRef): WorldAgentSetup | null {
  const { environmentId } = projectRef;
  const projectSettings = useProjectSettings(projectRef);
  const providers = useServerConfigs().get(environmentId)?.providers;
  const settings = useEnvironmentSettings(environmentId);
  return useMemo(
    () =>
      projectSettings === null || providers === undefined
        ? null
        : resolveWorldAgentSetup(providers, settings, projectSettings),
    [projectSettings, providers, settings],
  );
}

/**
 * The workspaces a new agent in a project can pick from, and the one a fresh
 * draft would use. Existing worktrees come from the repo's local branches that
 * are checked out somewhere other than the main checkout, which the project
 * folder sits in (or is) and the picker offers on its own; a new worktree
 * starts from the default branch, else the main checkout's current one. Until
 * git answers, the project counts as a repo so the picker shows right away.
 */
export function useWorldAgentWorkspaces(projectRef: ScopedProjectRef) {
  const { environmentId } = projectRef;
  const project = useProject(projectRef);
  const workspaceRoot = project?.workspaceRoot ?? null;
  // The project can be a folder inside the repo, so its root isn't always the checkout's.
  const repoRoot = project?.repositoryIdentity?.rootPath ?? workspaceRoot;
  // A live query, not a one-shot read: ref lists are streams that stay open,
  // so awaiting a settled result would never resolve. `refresh` reads Git
  // afresh rather than the server's recent snapshot.
  const refsAtom = useMemo(
    () =>
      workspaceRoot === null
        ? null
        : vcsEnvironment.listRefs({
            environmentId,
            input: { cwd: workspaceRoot, limit: 200, refresh: true },
          }),
    [environmentId, workspaceRoot],
  );
  const refs = useEnvironmentQuery(refsAtom);
  // Branches and worktrees also change outside the app, e.g. in a terminal, so
  // the picker reads them again every time it opens.
  const { refresh: refreshRefs } = refs;
  useEffect(() => refreshRefs(), [refreshRefs]);
  const isRepo = refs.failure === null && (refs.data?.isRepo ?? true);
  const worktrees = useMemo(
    () =>
      (refs.data?.refs ?? []).flatMap((ref) =>
        ref.isRemote !== true &&
        ref.worktreePath !== null &&
        ref.worktreePath !== workspaceRoot &&
        ref.worktreePath !== repoRoot
          ? [{ path: ref.worktreePath, branch: ref.name }]
          : [],
      ),
    [refs.data, workspaceRoot, repoRoot],
  );
  // The server lists the current and default branches first.
  const mainBranch = refs.data?.refs.find((ref) => ref.current)?.name ?? null;
  const worktreeBaseBranch = refs.data?.refs.find((ref) => ref.isDefault)?.name ?? mainBranch;

  const worktreeByDefault = useProjectSettings(projectRef)?.defaultThreadEnvMode === "worktree";

  const defaultWorkspace: WorldAgentWorkspace =
    isRepo && worktreeByDefault ? { kind: "new-worktree" } : { kind: "local" };
  return { defaultWorkspace, worktrees, mainBranch, worktreeBaseBranch, isRepo };
}

/**
 * Starts a thread in a project straight away, without opening its draft. It
 * runs with the given setup, which useWorldAgentSetup seeds with what a fresh
 * draft would pick. It works in the given workspace, else the project's
 * local-or-worktree default. A new worktree starts from the given base branch,
 * which useWorldAgentWorkspaces finds like the branch picker does.
 */
export function useStartWorldAgent() {
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  return useCallback(
    async (
      projectRef: ScopedProjectRef,
      outgoing: OutgoingMessage,
      workspace: WorldAgentWorkspace | null = null,
      worktreeBaseBranch: string | null = null,
      setup: WorldAgentSetup | null = null,
    ): Promise<ThreadId> => {
      if (setup === null) throw new Error("No agent provider is available.");
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

      const { modelSelection, runtimeMode } = setup;
      const provider = providers.find(
        (candidate) => candidate.instanceId === modelSelection.instanceId,
      );
      // Plan mode only where the provider offers it and the user turned it on.
      const { interactionMode } = resolveComposerInteractionMode({
        planModeEnabled: settings.planModeEnabled,
        provider,
        interactionMode: setup.interactionMode,
      });

      const baseBranch = workspaceKind === "new-worktree" ? worktreeBaseBranch : null;
      if (workspaceKind === "new-worktree" && baseBranch === null)
        throw new Error("Could not find a branch to base the worktree on.");

      const { text, attachments } = outgoing;
      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      // Named like the chat composer names it: the text, else the first image or file.
      const firstFile = attachments.find((attachment) => attachment.type === "file");
      const title = deriveThreadTitleSeed({
        text: stripInlineContextReferences(text),
        attachments: attachments.filter((attachment) => attachment.type === "image"),
        fallbackLabels: [firstFile && `File: ${firstFile.name}`],
      });
      const result = await startTurn({
        environmentId,
        input: {
          threadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
            attachments: [...attachments],
            ...(outgoing.context !== undefined ? { context: outgoing.context } : {}),
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
