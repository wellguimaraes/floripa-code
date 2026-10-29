import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import {
  type ComponentProps,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useVcsPullAction } from "../../lib/sourceControlActions";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useProject, useServerConfigs, useThreadShellsForProjectRefs } from "../../state/entities";
import {
  ComposerFooterModeControls,
  type RuntimeModeOption,
  runtimeModeOptions,
} from "../chat/ChatComposer";
import { CompactComposerControlsMenu } from "../chat/CompactComposerControlsMenu";
import { ComposerControlSeparator } from "../chat/ComposerControl";
import {
  ComposerControlBlocks,
  useRestingComposerControlsLayout,
} from "../chat/ComposerControlBlocks";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { shouldRenderTraitsControls, TraitsMenuContent, TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorktreeBaseBranchPicker } from "../WorktreeBaseBranchPicker";
import { BubbleComposer } from "./BubbleComposer";
import { HuePicker } from "./HuePicker";
import type { NewAgentDraft } from "./newAgentDraftStore";
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
import type { WorldIsland } from "./engine/archipelago";
import { worktreesByRecency } from "./worktreesByRecency";

const CharacterPortrait = lazy(() => import("./scene/CharacterPortrait"));

const workspaceValue = (workspace: WorldAgentWorkspace) =>
  workspace.kind === "worktree" ? `worktree:${workspace.path}` : workspace.kind;

/** A local branch as Git lists it, with how it compares with origin's copy as last fetched. */
function useLocalBranch(
  environmentId: ScopedProjectRef["environmentId"],
  cwd: string | null,
  branch: string | null,
) {
  const refs = useEnvironmentQuery(
    cwd !== null && branch !== null
      ? vcsEnvironment.listRefs({
          environmentId,
          input: { cwd, query: branch, limit: 10, includeOriginComparison: true },
        })
      : null,
  );
  return refs.data?.refs.find((ref) => ref.name === branch && ref.isRemote !== true);
}

/**
 * Pulls the branch checked out at `cwd`, toasting a failure. `sync` is null when nothing is
 * checked out there or this connection can't change source control.
 */
function useBranchPull(environmentId: ScopedProjectRef["environmentId"], cwd: string | null) {
  const scope = useMemo(() => ({ environmentId, cwd }), [environmentId, cwd]);
  const pull = useVcsPullAction(scope);
  const sync = async () => {
    const result = await pull.run();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Pull failed",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };
  return {
    sync: cwd !== null && pull.isAllowed ? () => void sync() : null,
    syncing: pull.isPending,
  };
}

/**
 * Starts an agent from an empty spot on an island. Enter sends the text as the
 * first message of a new thread in that project, with any attached, dropped,
 * or pasted files, using the defaults a fresh draft would; an open chat switches to it.
 * In a repo it first asks where the agent works: the main worktree, a new worktree,
 * or another existing one, the most recently used first. A new worktree's base branch
 * is picked in the composer step, starting from the default branch.
 * The model, its traits, permissions and plan mode use the chat's own pickers;
 * a picked model becomes the default for new chats once the agent starts.
 * The text box, files, voice and send live in BubbleComposer, shared by both bubbles.
 * Closed before the agent starts, it leaves its task as the island's draft: the next
 * bubble there asks where again, then opens on that text, selected. Files are not kept.
 */
export function NewAgentBubble(props: {
  readonly islandName: string;
  readonly project: ScopedProjectRef;
  /** The family colour picked at first: one nobody on the island wears yet. */
  readonly suggestedHue: number;
  /** The island as the world draws it, for its worktree hats and agents; null while it has none. */
  readonly island: WorldIsland | null;
  /** The island's draft, left by a bubble closed before its agent started. */
  readonly draft: NewAgentDraft | null;
  readonly onClose: () => void;
  /** Gone without starting an agent, with what it held. */
  readonly onLeave: (draft: NewAgentDraft) => void;
  /** The thread exists and its first turn is starting. */
  readonly onStarted: (thread: {
    readonly key: string;
    readonly ref: ScopedThreadRef;
    readonly hue: number;
  }) => void;
}) {
  const { islandName, project, suggestedHue, island, draft, onClose, onLeave, onStarted } = props;
  const [hue, setHue] = useState(draft?.hue ?? suggestedHue);
  const startAgent = useStartWorldAgent();
  const [text, setText] = useState(draft?.text ?? "");
  const workspaces = useWorldAgentWorkspaces(project);
  const { environmentId, projectId } = project;
  const projectRefs = useMemo(() => [{ environmentId, projectId }], [environmentId, projectId]);
  const projectThreads = useThreadShellsForProjectRefs(projectRefs);
  // Null until picked: the project's default applies.
  const [workspace, setWorkspace] = useState<WorldAgentWorkspace | null>(draft?.workspace ?? null);
  // The first step, in a repo: where the agent works.
  const [pickingWorkspace, setPickingWorkspace] = useState(true);
  // Subagents follow their parent, so only top-level agents count.
  const agentsIn = (worktreePath: string | null) =>
    island?.characters.filter(({ facts }) => !facts.kid && facts.worktreePath === worktreePath)
      .length ?? 0;
  const workspaceRoot = useProject(project)?.workspaceRoot ?? null;
  const mainRef = useLocalBranch(environmentId, workspaceRoot, workspaces.mainBranch);
  const defaultBaseRef = useLocalBranch(
    environmentId,
    workspaceRoot,
    workspaces.worktreeBaseBranch,
  );
  // Each pulls where its branch is checked out: the main worktree's in the project folder.
  const mainPull = useBranchPull(environmentId, workspaceRoot);
  const defaultBasePull = useBranchPull(environmentId, defaultBaseRef?.worktreePath ?? null);
  const workspaceItems: ReadonlyArray<PickableWorkspace> = [
    {
      value: "local",
      label: "Main worktree",
      detail: workspaces.mainBranch ?? "The project folder",
      behind: mainRef?.originComparison?.behind ?? 0,
      ...mainPull,
      workspace: { kind: "local" },
      hat: null,
      agents: agentsIn(null),
    },
    {
      value: "new-worktree",
      label: "New worktree",
      // Its base can be changed on the next step.
      detail:
        workspaces.worktreeBaseBranch === null ? null : `from ${workspaces.worktreeBaseBranch}`,
      behind: defaultBaseRef?.originComparison?.behind ?? 0,
      ...defaultBasePull,
      workspace: { kind: "new-worktree" },
      hat: null,
      agents: 0,
    },
    ...worktreesByRecency(workspaces.worktrees, projectThreads).map((worktree) => {
      const item: WorldAgentWorkspace = { kind: "worktree", ...worktree };
      return {
        value: workspaceValue(item),
        label: worktree.branch,
        detail: worktree.path.split(/[\\/]/).findLast((part) => part !== "") ?? worktree.path,
        behind: 0,
        sync: null,
        syncing: false,
        workspace: item,
        hat: island?.hats.get(worktree.path) ?? null,
        agents: agentsIn(worktree.path),
      };
    }),
  ];
  const selectedWorkspace = workspace ?? workspaces.defaultWorkspace;

  const providers =
    useServerConfigs().get(project.environmentId)?.providers ?? EMPTY_SERVER_PROVIDERS;
  const settings = useEnvironmentSettings(project.environmentId);
  const defaultSetup = useWorldAgentSetup(project);
  // Picks layered over the defaults, so defaults that land later still fill the rest.
  const [picked, setPicked] = useState<Partial<WorldAgentSetup>>(draft?.picked ?? {});
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
  const baseBranch =
    selectedWorkspace.kind === "new-worktree"
      ? (selectedWorkspace.baseBranch ?? workspaces.worktreeBaseBranch)
      : null;
  const originComparison = useLocalBranch(
    environmentId,
    workspaceRoot,
    baseBranch,
  )?.originComparison;
  // A local base that only trails origin would start the agent on stale code, so it starts from
  // origin instead. One with commits of its own stays local: origin would drop them.
  const behindOrigin =
    originComparison !== undefined && originComparison.ahead === 0 ? originComparison.behind : 0;
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
  // However it closes, an agent that never started leaves its task behind.
  const started = useRef(false);
  const leave = useEffectEvent(() => {
    if (!started.current) onLeave({ text, workspace, hue, picked });
  });
  useEffect(() => () => leave(), []);

  const start = async () => {
    if (state.phase === "starting" || attachments.preparing || empty) return;
    setState({ phase: "starting" });
    try {
      const outgoing = await attachments.prepareForSend(text.trim());
      const threadId = await startAgent(
        project,
        outgoing,
        selectedWorkspace.kind === "new-worktree"
          ? { ...selectedWorkspace, startFromOrigin: behindOrigin > 0 }
          : workspace,
        workspaces.worktreeBaseBranch,
        setup === null || runtimeMode === undefined ? null : { ...setup, runtimeMode },
      );
      attachments.sent();
      // A model picked here becomes the next chat's default, as a pick in the chat does.
      if (picked.modelSelection !== undefined)
        useComposerDraftStore.getState().setStickyModelSelection(picked.modelSelection);
      const ref = { environmentId: project.environmentId, threadId };
      started.current = true;
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
      onTextChange={setText}
      // A draft comes back whole, so typing replaces it and a click keeps it.
      selectOnOpen={draft !== null && draft.text !== ""}
      onSubmit={() => void start()}
      onClose={onClose}
      placeholder="What should it work on?"
      inputLabel={`Task for a new agent on ${islandName}`}
      submitLabel="Start"
      speakLabel="Speak the task"
      width="wide"
      error={state.phase === "error" ? state.message : null}
      onError={showError}
      busy={state.phase === "starting"}
      // The send button spins; only a new worktree's slower setup gets a line.
      busyStatus={selectedWorkspace.kind === "new-worktree" ? "Preparing the new worktree…" : null}
      header={
        // Ruled off below, edge to edge, like the other bubbles' headers.
        <div className="-mx-2.5 flex items-stretch gap-1.5 border-b border-border px-2.5 pb-3">
          <NewAgentCharacter hue={hue} onHueChange={setHue} />
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <span className="max-w-full truncate text-base font-medium">Start New Agent</span>
            {workspaces.isRepo && selectedWorkspace.kind === "new-worktree" ? (
              <div className="flex max-w-full min-w-0 items-center gap-1">
                <WorktreeBaseBranchPicker
                  environmentId={project.environmentId}
                  cwd={workspaceRoot}
                  value={selectedWorkspace.baseBranch ?? workspaces.worktreeBaseBranch ?? ""}
                  onValueChange={(baseBranch) => setWorkspace({ ...selectedWorkspace, baseBranch })}
                  startFromOrigin={behindOrigin > 0}
                  disabled={state.phase === "starting"}
                  size="xs"
                  prefix={
                    <span className="inline-flex shrink-0 items-center gap-2 pl-1 text-muted-foreground">
                      <WorkspaceIcon workspace={selectedWorkspace} className="size-3 shrink-0" />
                      New worktree from
                    </span>
                  }
                />
                {behindOrigin > 0 && baseBranch !== null ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span aria-label="Starting from origin" className="flex shrink-0" />}
                    >
                      <TriangleAlertIcon aria-hidden className="size-3.5 text-warning" />
                    </TooltipTrigger>
                    <TooltipPopup side="top" className="max-w-64 whitespace-normal">
                      Local {baseBranch} is {behindOrigin}{" "}
                      {behindOrigin === 1 ? "commit" : "commits"} behind origin, so the new worktree
                      starts from origin/{baseBranch}.
                    </TooltipPopup>
                  </Tooltip>
                ) : null}
              </div>
            ) : workspaces.isRepo ? (
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
                <SelectPrimitive.Trigger
                  aria-label="Workspace"
                  className={cn(
                    "flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm",
                    "text-xs leading-4 text-muted-foreground outline-none hover:text-foreground",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    "data-disabled:pointer-events-none data-disabled:opacity-64",
                  )}
                >
                  <WorkspaceIcon workspace={selectedWorkspace} className="size-3 shrink-0" />
                  <SelectValue />
                </SelectPrimitive.Trigger>
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
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
            <XIcon />
          </Button>
        </div>
      }
      toolbar={
        setup !== null && providerEntry !== undefined && runtimeMode !== undefined ? (
          <NewAgentControls
            modelPicker={
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
                size="sm"
                triggerClassName="min-w-13 shrink"
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
                disabled={state.phase === "starting"}
                onInstanceModelChange={pickModel}
              />
            }
            traits={{
              provider: providerEntry.driverKind,
              instanceId: setup.modelSelection.instanceId,
              models: providerEntry.models,
              model: setup.modelSelection.model,
              prompt: text,
              onPromptChange: setText,
              modelOptions: setup.modelSelection.options ?? [],
              planModeEnabled: settings.planModeEnabled,
              onModelOptionsChange: (options) =>
                setPicked((current) => ({
                  ...current,
                  modelSelection: createModelSelection(
                    setup.modelSelection.instanceId,
                    setup.modelSelection.model,
                    options,
                  ),
                })),
            }}
            disabled={state.phase === "starting"}
            showInteractionModeToggle={planModeAvailable}
            interactionMode={planModeAvailable ? setup.interactionMode : "default"}
            runtimeMode={runtimeMode}
            runtimeModeOptions={compatibleRuntimeModeOptions}
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
        ) : null
      }
    />
  );
}

/**
 * The model, traits and mode pickers, fitted to the bubble as the chat's own footer fits
 * them: trailing labels go first, then trailing pickers move into an overflow menu.
 */
function NewAgentControls(props: {
  readonly modelPicker: ReactNode;
  readonly traits: ComponentProps<typeof TraitsMenuContent>;
  readonly disabled: boolean;
  readonly showInteractionModeToggle: boolean;
  readonly interactionMode: ProviderInteractionMode;
  readonly runtimeMode: RuntimeMode;
  readonly runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  readonly onToggleInteractionMode: () => void;
  readonly onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const { traits, disabled } = props;
  const layout = useRestingComposerControlsLayout(null, true);
  const blocks = [
    ...(shouldRenderTraitsControls({ ...traits, modelOptions: traits.modelOptions })
      ? [
          {
            id: "traits",
            content: (
              <>
                <ComposerControlSeparator size="sm" />
                <TraitsPicker
                  {...traits}
                  size="sm"
                  disabled={disabled}
                  hidden={layout.hiddenBlockCount > 1}
                />
              </>
            ),
          },
        ]
      : []),
    {
      id: "mode",
      content: (
        <ComposerFooterModeControls
          showInteractionModeToggle={props.showInteractionModeToggle}
          interactionMode={props.interactionMode}
          runtimeMode={props.runtimeMode}
          runtimeModeOptions={props.runtimeModeOptions}
          size="sm"
          hidden={layout.hiddenBlockCount > 0}
          onToggleInteractionMode={props.onToggleInteractionMode}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />
      ),
    },
  ];
  return (
    <div ref={layout.attachControls} className="relative flex min-w-0 items-center gap-1">
      {props.modelPicker}
      <ComposerControlBlocks
        blocks={blocks}
        hiddenBlockCount={layout.hiddenBlockCount}
        iconOnlyBlockCount={layout.iconOnlyBlockCount}
        renderOverflowMenu={(hiddenBlockIds) => (
          <CompactComposerControlsMenu
            interactionMode={props.interactionMode}
            runtimeMode={props.runtimeMode}
            runtimeModeOptions={props.runtimeModeOptions}
            size="sm"
            hidden={hiddenBlockIds.length === 0}
            showInteractionModeToggle={
              props.showInteractionModeToggle && hiddenBlockIds.includes("mode")
            }
            traitsMenuContent={
              hiddenBlockIds.includes("traits") ? <TraitsMenuContent {...traits} /> : undefined
            }
            onToggleInteractionMode={props.onToggleInteractionMode}
            onRuntimeModeChange={props.onRuntimeModeChange}
          />
        )}
      />
    </div>
  );
}

/** The new agent's portrait, in the colour it will arrive in; clicking it picks another. */
function NewAgentCharacter(props: {
  readonly hue: number;
  readonly onHueChange: (hue: number) => void;
}) {
  const { hue, onHueChange } = props;
  const [picking, setPicking] = useState(false);
  return (
    <Popover open={picking} onOpenChange={setPicking}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label="Change color"
                  className={cn(
                    "w-10 shrink-0 cursor-pointer rounded-md outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  )}
                />
              }
            />
          }
        >
          <Suspense fallback={<div className="size-full" />}>
            <CharacterPortrait hue={hue} hat={null} className="size-full" />
          </Suspense>
        </TooltipTrigger>
        <TooltipPopup side="top">Change color</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="start" padding="compact">
        <HuePicker
          hue={hue}
          onChange={(picked) => {
            onHueChange(picked);
            setPicking(false);
          }}
        />
      </PopoverPopup>
    </Popover>
  );
}
