import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ProviderInstanceId, ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useProject, useServerConfigs, useThreadShellsForProjectRefs } from "../../state/entities";
import { ComposerFooterModeControls, runtimeModeOptions } from "../chat/ChatComposer";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { BubbleComposer } from "./BubbleComposer";
import { HuePicker } from "./HuePicker";
import { lastUsedWorkspaceValue } from "./lastUsedWorkspace";
import {
  NewAgentWorkspacePicker,
  type PickableWorkspace,
  WorkspaceIcon,
} from "./NewAgentWorkspacePicker";
import { useBubbleAttachments } from "./useBubbleAttachments";
import {
  useStartWorldAgent,
  useWorldAgentSetup,
  useWorldAgentWorkspaces,
  type WorldAgentSetup,
  type WorldAgentWorkspace,
} from "./useStartWorldAgent";

const workspaceValue = (workspace: WorldAgentWorkspace) =>
  workspace.kind === "worktree" ? `worktree:${workspace.path}` : workspace.kind;

/**
 * Starts an agent from an empty spot on an island. Enter sends the text as the
 * first message of a new thread in that project, with any attached, dropped,
 * or pasted files, using the defaults a fresh draft would; an open chat switches to it.
 * In a repo it first asks where the agent works: the main worktree, a new worktree,
 * or another existing one, starting on the one the project's latest thread uses.
 * The model, its traits, permissions and plan mode use the chat's own pickers;
 * a picked model becomes the default for new chats once the agent starts.
 * The text box, files, voice and send live in BubbleComposer, shared by both bubbles.
 */
export function NewAgentBubble(props: {
  readonly islandName: string;
  readonly project: ScopedProjectRef;
  /** The family colour picked at first: one nobody on the island wears yet. */
  readonly suggestedHue: number;
  readonly onClose: () => void;
  readonly onTextChange: (text: string) => void;
  /** The thread exists and its first turn is starting. */
  readonly onStarted: (thread: {
    readonly key: string;
    readonly ref: ScopedThreadRef;
    readonly hue: number;
  }) => void;
}) {
  const { islandName, project, suggestedHue, onClose, onTextChange, onStarted } = props;
  const [hue, setHue] = useState(suggestedHue);
  const startAgent = useStartWorldAgent();
  const [text, setText] = useState("");
  const workspaces = useWorldAgentWorkspaces(project);
  const { environmentId, projectId } = project;
  const projectRefs = useMemo(() => [{ environmentId, projectId }], [environmentId, projectId]);
  const projectThreads = useThreadShellsForProjectRefs(projectRefs);
  // Null until picked: the project's default applies.
  const [workspace, setWorkspace] = useState<WorldAgentWorkspace | null>(null);
  // The first step, in a repo: where the agent works.
  const [pickingWorkspace, setPickingWorkspace] = useState(true);
  const workspaceItems: ReadonlyArray<PickableWorkspace> = [
    {
      value: "local",
      label: "Main worktree",
      detail: workspaces.mainBranch ?? "The project folder",
      workspace: { kind: "local" },
    },
    {
      value: "new-worktree",
      label: "New worktree",
      detail:
        workspaces.worktreeBaseBranch === null
          ? "From the default branch"
          : `From ${workspaces.worktreeBaseBranch}`,
      workspace: { kind: "new-worktree" },
    },
    ...workspaces.worktrees.map((worktree) => {
      const item: WorldAgentWorkspace = { kind: "worktree", ...worktree };
      return {
        value: workspaceValue(item),
        label: worktree.branch,
        detail: worktree.path.split(/[\\/]/).findLast((part) => part !== "") ?? worktree.path,
        workspace: item,
      };
    }),
  ];
  // The one the project's latest thread uses while it still exists, else the project's default.
  const lastUsed = lastUsedWorkspaceValue(
    projectThreads,
    new Set(workspaceItems.map((item) => item.value)),
  );
  const defaultWorkspace =
    workspaceItems.find((item) => item.value === lastUsed)?.workspace ??
    workspaces.defaultWorkspace;
  const selectedWorkspace = workspace ?? defaultWorkspace;

  const providers =
    useServerConfigs().get(project.environmentId)?.providers ?? EMPTY_SERVER_PROVIDERS;
  const settings = useEnvironmentSettings(project.environmentId);
  const defaultSetup = useWorldAgentSetup(project);
  // Picks layered over the defaults, so defaults that land later still fill the rest.
  const [picked, setPicked] = useState<Partial<WorldAgentSetup>>({});
  const setup = defaultSetup === null ? null : { ...defaultSetup, ...picked };
  const providerEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const providerEntry =
    setup === null
      ? undefined
      : providerEntries.find((entry) => entry.instanceId === setup.modelSelection.instanceId);
  // Like the chat: only the modes this provider supports, showing its first when the pick isn't one.
  const supportedRuntimeModes = providerEntry?.snapshot.supportedRuntimeModes ?? [];
  const compatibleRuntimeModeOptions =
    supportedRuntimeModes.length > 0
      ? runtimeModeOptions.filter((option) => supportedRuntimeModes.includes(option.mode))
      : runtimeModeOptions;
  const runtimeMode =
    setup === null ||
    compatibleRuntimeModeOptions.some((option) => option.mode === setup.runtimeMode)
      ? setup?.runtimeMode
      : compatibleRuntimeModeOptions[0]?.mode;
  const planModeAvailable =
    settings.planModeEnabled && providerEntry?.snapshot.showInteractionModeToggle !== false;
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  // The chat's own `/` commands that make sense before the agent exists.
  const slashCommands = [
    { command: "model" as const, description: "Pick the model for this agent" },
    ...(planModeAvailable
      ? [
          { command: "plan" as const, description: "Start this agent in plan mode" },
          { command: "default" as const, description: "Start this agent in build mode" },
        ]
      : []),
  ];
  const workspaceRoot = useProject(project)?.workspaceRoot ?? null;
  const pickModel = (instanceId: ProviderInstanceId, model: string) => {
    // Bring back the traits last used with this model, as the chat does.
    const { stickyOptionsByModelByProvider, stickyModelSelectionByProvider } =
      useComposerDraftStore.getState();
    const sticky = stickyModelSelectionByProvider[instanceId];
    const options =
      stickyOptionsByModelByProvider[instanceId]?.[model] ??
      (sticky?.model === model ? sticky.options : undefined);
    setPicked((current) => ({
      ...current,
      modelSelection: createModelSelection(instanceId, model, options),
    }));
  };
  const attachments = useBubbleAttachments(project.environmentId);
  const [state, setState] = useState<
    { readonly phase: "idle" | "starting" } | { readonly phase: "error"; message: string }
  >({ phase: "idle" });
  const empty = text.trim() === "" && attachments.attachments.length === 0;

  // Errors from the composer (files, voice) share the status line with the bubble's own.
  const showError = (message: string | null) =>
    setState((current) =>
      message !== null
        ? { phase: "error", message }
        : current.phase === "error"
          ? { phase: "idle" }
          : current,
    );
  const changeText = (next: string) => {
    setText(next);
    onTextChange(next);
  };

  const start = async () => {
    if (state.phase === "starting" || attachments.preparing || empty) return;
    setState({ phase: "starting" });
    try {
      const outgoing = await attachments.prepareForSend();
      const threadId = await startAgent(
        project,
        text.trim(),
        outgoing,
        workspace,
        workspaces.worktreeBaseBranch,
        setup === null || runtimeMode === undefined ? null : { ...setup, runtimeMode },
      );
      attachments.sent();
      // A model picked here becomes the next chat's default, as a pick in the chat does.
      if (picked.modelSelection !== undefined)
        useComposerDraftStore.getState().setStickyModelSelection(picked.modelSelection);
      const ref = { environmentId: project.environmentId, threadId };
      onStarted({ key: scopedThreadKey(ref), ref, hue });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not start an agent here.",
      });
    }
  };

  if (pickingWorkspace && workspaces.isRepo)
    return (
      <NewAgentWorkspacePicker
        islandName={islandName}
        workspaces={workspaceItems}
        defaultValue={workspaceValue(selectedWorkspace)}
        onPick={(picked) => {
          setWorkspace(picked);
          setPickingWorkspace(false);
        }}
        onClose={onClose}
      />
    );

  return (
    <BubbleComposer
      cwd={selectedWorkspace.kind === "worktree" ? selectedWorkspace.path : workspaceRoot}
      provider={providerEntry?.snapshot ?? null}
      slashCommands={slashCommands}
      onSlashCommand={(command) => {
        if (command === "model") setModelPickerOpen(true);
        else setPicked((current) => ({ ...current, interactionMode: command }));
      }}
      environmentId={project.environmentId}
      attachments={attachments}
      text={text}
      onTextChange={changeText}
      onSubmit={() => void start()}
      onClose={onClose}
      narrow
      placeholder="What should it work on?"
      inputLabel={`Task for a new agent on ${islandName}`}
      submitLabel="Start"
      speakLabel="Speak the task"
      footerStart={<HuePicker hue={hue} onChange={setHue} />}
      error={state.phase === "error" ? state.message : null}
      onError={showError}
      busy={state.phase === "starting"}
      busyStatus="Starting…"
      header={
        <>
          <div className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">New agent</span>
              <span className="truncate text-xs text-muted-foreground">on {islandName}</span>
            </div>
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          </div>
          {workspaces.isRepo ? (
            <Select
              modal={false}
              value={workspaceValue(selectedWorkspace)}
              items={workspaceItems}
              disabled={state.phase === "starting"}
              onValueChange={(value: string | null) => {
                const item = workspaceItems.find((candidate) => candidate.value === value);
                if (item !== undefined) setWorkspace(item.workspace);
              }}
            >
              <SelectTrigger size="xs" aria-label="Workspace">
                <WorkspaceIcon workspace={selectedWorkspace} />
                <SelectValue />
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>
                {workspaceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <WorkspaceIcon workspace={item.workspace} className="size-3" />
                      <span className="truncate">{item.label}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
        </>
      }
    >
      {setup !== null && providerEntry !== undefined && runtimeMode !== undefined ? (
        <div className="-mx-1 flex flex-wrap items-center gap-y-1">
          <ProviderModelPicker
            activeInstanceId={setup.modelSelection.instanceId}
            model={setup.modelSelection.model}
            lockedProvider={null}
            instanceEntries={providerEntries}
            modelOptionsByInstance={getCustomModelOptionsByInstance(
              settings,
              providers,
              setup.modelSelection.instanceId,
              setup.modelSelection.model,
            )}
            size="xs"
            triggerClassName="min-w-0 shrink"
            open={modelPickerOpen}
            onOpenChange={setModelPickerOpen}
            disabled={state.phase === "starting"}
            onInstanceModelChange={pickModel}
          />
          <TraitsPicker
            provider={providerEntry.driverKind}
            instanceId={setup.modelSelection.instanceId}
            models={providerEntry.models}
            model={setup.modelSelection.model}
            prompt={text}
            onPromptChange={changeText}
            modelOptions={setup.modelSelection.options ?? []}
            planModeEnabled={settings.planModeEnabled}
            size="xs"
            disabled={state.phase === "starting"}
            onModelOptionsChange={(options) =>
              setPicked((current) => ({
                ...current,
                modelSelection: createModelSelection(
                  setup.modelSelection.instanceId,
                  setup.modelSelection.model,
                  options,
                ),
              }))
            }
          />
          <ComposerFooterModeControls
            showInteractionModeToggle={planModeAvailable}
            interactionMode={planModeAvailable ? setup.interactionMode : "default"}
            runtimeMode={runtimeMode}
            runtimeModeOptions={compatibleRuntimeModeOptions}
            size="xs"
            onToggleInteractionMode={() =>
              setPicked((current) => ({
                ...current,
                interactionMode: setup.interactionMode === "plan" ? "default" : "plan",
              }))
            }
            onRuntimeModeChange={(mode) =>
              setPicked((current) => ({ ...current, runtimeMode: mode }))
            }
          />
        </div>
      ) : null}
    </BubbleComposer>
  );
}
