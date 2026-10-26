import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveProviderSkillsForCwd } from "@t3tools/client-runtime/providerSkills";
import { fileBasename } from "@t3tools/shared/path";
import type { ServerProvider } from "@t3tools/contracts";
import { ArchiveIcon, MessagesSquareIcon, RefreshCwIcon, SquareIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadActions } from "../../hooks/useThreadActions";
import { formatShortcutLabel } from "../../keybindings";
import { observeResize } from "../../lib/observeResize";
import { cn, newMessageId } from "../../lib/utils";
import {
  readEnvironmentSupportsTitleRegeneration,
  useProject,
  useServerConfigs,
  useThreadShell,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useTheme } from "../../hooks/useTheme";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../chat/composerPromptHistory";
import { ClampedUserMessage, type UserMessageChipState } from "../chat/MessagesTimeline";
import { BubbleComposer } from "./BubbleComposer";
import type { CharacterFacts } from "./engine/facts";
import { HuePicker } from "./HuePicker";
import { type FamilyShades as Shades, palette } from "./scene/palette";
import { useBubbleAttachments } from "./useBubbleAttachments";
import { ARCHIVE_SHORTCUT, confirmArchive, useArchiveShortcut } from "./useArchiveShortcut";
import type { QueuedSend } from "./lastExchange";
import { LatestTurn } from "./LatestTurn";
import { RollingSwap } from "./RollingSwap";
import { useLastExchange } from "./useLastExchange";

/**
 * Whether the character's thread has a run to stop: working, waiting on you,
 * or still running something in the background. Subagents stop with their parent.
 */
export function isStoppable(facts: CharacterFacts): boolean {
  if (facts.kid) return false;
  if (facts.status === "waiting") return facts.backgroundTask || facts.hasWorkingKids;
  return ["working", "approval", "input"].includes(facts.status);
}

const EMPTY_SKILLS: UserMessageChipState["skills"] = [];
const EMPTY_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const NOOP = () => {};

const NO_MODIFIERS = {
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  modKey: false,
};
// Handled by the composer's Enter key.
const EXPAND_SHORTCUT = formatShortcutLabel({ ...NO_MODIFIERS, key: "enter", modKey: true });

/**
 * A quick reply box beside a character: send a message without leaving the
 * world, or expand into the full chat with whatever was typed so far.
 * The text box, files, voice and send live in BubbleComposer, shared by both bubbles.
 */
export function WorldBubble(props: {
  readonly facts: CharacterFacts;
  readonly onClose: () => void;
  readonly onExpand: () => void;
  /** The thread was archived; the world plays the character's exit. */
  readonly onArchived: () => void;
  /** Start listening at once and send what was said: a voice command. */
  readonly listen?: boolean;
  /** The family colour the character wears now. */
  readonly hue: number;
  /** Repaint the character's family: it and its subagents (or its parent and siblings). */
  readonly onHueChange: (hue: number) => void;
}) {
  const { facts, onClose, onExpand, onArchived, listen = false, hue, onHueChange } = props;
  const { archiveThread } = useThreadActions();
  const thread = useThreadShell(facts.ref);
  const project = useProject(
    thread === null ? null : { environmentId: thread.environmentId, projectId: thread.projectId },
  );
  // Suggestions come from where the thread works and the provider it talks to.
  const providers = useServerConfigs().get(facts.ref.environmentId)?.providers;
  const provider =
    providers?.find((candidate) => candidate.instanceId === thread?.modelSelection.instanceId) ??
    null;
  const { sent: lastSent } = useLastExchange(facts.ref);
  // The exchange opens scrolled to its end, where the latest words are, and follows the agent's
  // work as it grows unless you scrolled up to read.
  const exchange = useRef<HTMLDivElement>(null);
  const archiveButton = useRef<HTMLButtonElement>(null);
  const exchangeContent = useRef<HTMLDivElement>(null);
  const followingEnd = useRef(true);
  // Scrolled away from the top: the reply is passing under your pinned message.
  const [exchangeScrolled, setExchangeScrolled] = useState(false);
  const { resolvedTheme } = useTheme();
  // Both messages render as the chat does, chips and skills included.
  const cwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const skills = useMemo(
    () => (provider === null ? EMPTY_SKILLS : resolveProviderSkillsForCwd(provider, cwd)),
    [provider, cwd],
  );
  const chips = useMemo<UserMessageChipState>(
    () => ({
      threadRef: facts.ref,
      markdownCwd: cwd ?? undefined,
      resolvedTheme,
      workspaceRoot: project?.workspaceRoot,
      skills,
      activeThreadEnvironmentId: facts.ref.environmentId,
      // The sent message's chips are labels only.
      openPullRequest: NOOP,
      onImageExpand: NOOP,
    }),
    [facts.ref, cwd, resolvedTheme, project?.workspaceRoot, skills],
  );
  useLayoutEffect(() => {
    const element = exchange.current;
    const content = exchangeContent.current;
    if (element === null || content === null) return;
    const toEnd = () => {
      if (followingEnd.current) element.scrollTop = element.scrollHeight;
    };
    toEnd();
    return observeResize(content, toEnd);
  }, []);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const regeneratingTitle = thread?.titleRegeneration != null;
  // Worktree folders are often generated (e.g. `t3-8f432bc3`), so a worktree goes by its branch.
  const worktreeLabel =
    thread === null
      ? null
      : thread.worktreePath === null
        ? "Main worktree"
        : (thread.branch ?? fileBasename(thread.worktreePath));
  const [pickingHue, setPickingHue] = useState(false);
  // The thread's composer draft, shared with the chat panel: what you type in either shows in both.
  const draftTarget = useMemo(
    () => scopeThreadRef(facts.ref.environmentId, facts.ref.threadId),
    [facts.ref.environmentId, facts.ref.threadId],
  );
  const text = useComposerDraftStore((store) => store.getComposerDraft(draftTarget)?.prompt ?? "");
  const setText = (next: string) => useComposerDraftStore.getState().setPrompt(draftTarget, next);
  const attachments = useBubbleAttachments(facts.ref.environmentId, draftTarget);
  const [state, setState] = useState<
    | { readonly phase: "idle" | "sending" | "stopping" | "archiving" }
    | { readonly phase: "error"; message: string }
  >({ phase: "idle" });

  // Errors from the composer (files, voice) share the status line with the bubble's own.
  const showError = (message: string | null) =>
    setState((current) =>
      message !== null
        ? { phase: "error", message }
        : current.phase === "error"
          ? { phase: "idle" }
          : current,
    );

  const send = async (said: string) => {
    const message = said.trim();
    const hasAttachments = attachments.attachments.length > 0;
    if (message === "" && !hasAttachments) return;
    if (thread === null || state.phase === "sending" || attachments.preparing) return;
    setState({ phase: "sending" });
    let outgoing;
    try {
      outgoing = await attachments.prepareForSend(message);
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not attach the files.",
      });
      return;
    }
    const result = await startTurn({
      environmentId: facts.ref.environmentId,
      input: {
        threadId: facts.ref.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: outgoing.text || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
          attachments: [...outgoing.attachments],
          ...(outgoing.context !== undefined ? { context: outgoing.context } : {}),
        },
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        // Never interrupts a running turn: the message waits for it to end.
        dispatchMode: "queue",
      },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not send the message.",
      });
      return;
    }
    // Sent: the bubble has done its job, and the shared draft is empty again.
    attachments.sent();
    onClose();
  };

  const stop = async () => {
    if (state.phase === "stopping") return;
    setState({ phase: "stopping" });
    const result = await interruptTurn({
      environmentId: facts.ref.environmentId,
      input: { threadId: facts.ref.threadId },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not stop the run.",
      });
      return;
    }
    setState({ phase: "idle" });
  };

  // The new title arrives on the thread shell; until then the button spins.
  const regenerateTitle = async () => {
    if (regeneratingTitle) return;
    const result = await updateMetadata({
      environmentId: facts.ref.environmentId,
      input: { threadId: facts.ref.threadId, regenerateTitle: true },
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not regenerate the title.",
      });
    }
  };

  // Archive, not delete: it can be undone from the toast or Settings → Archived.
  const archive = async () => {
    if (state.phase === "archiving") return;
    if (!(await confirmArchive(archiveButton.current))) return;
    setState({ phase: "archiving" });
    const result = await archiveThread(facts.ref);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setState({
        phase: "error",
        message:
          error instanceof Error && error.message !== "" ? error.message : "Could not archive.",
      });
      return;
    }
    onArchived();
  };

  useArchiveShortcut(archive);

  // The draft is the chat's own, so the full chat opens with it as it stands.
  const expand = onExpand;

  return (
    <BubbleComposer
      environmentId={facts.ref.environmentId}
      cwd={cwd}
      provider={provider}
      attachments={attachments}
      text={text}
      onTextChange={setText}
      onSubmit={(said) => void send(said)}
      onExpand={expand}
      onClose={onClose}
      placeholder="Message this agent"
      inputLabel={`Message ${facts.title || "this agent"}`}
      submitLabel="Send"
      speakLabel="Speak a message"
      hint={
        <>
          <Kbd variant="outline">Enter</Kbd> to send
          <span className="mx-2">·</span>
          <Kbd variant="outline">{EXPAND_SHORTCUT}</Kbd> to open full chat
        </>
      }
      error={state.phase === "error" ? state.message : null}
      onError={showError}
      busy={state.phase === "sending"}
      busyStatus={attachments.attachments.length > 0 ? "Uploading…" : null}
      notice={state.phase === "stopping" ? "Stopping…" : null}
      submitBlocked={thread === null}
      listenOnOpen={listen}
      header={
        <>
          <div className="-mx-2.5 flex items-center gap-2 border-b border-border px-2.5 pb-2">
            {/* Subagents share the family colour, so a kid repaints its parent and siblings too. */}
            <Popover open={pickingHue} onOpenChange={setPickingHue}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label="Change color"
                    title="Change color"
                  />
                }
              >
                <FamilyShades shades={palette.families[hue]} />
              </PopoverTrigger>
              <PopoverPopup side="bottom" align="start" padding="compact">
                <HuePicker
                  hue={hue}
                  onChange={(picked) => {
                    onHueChange(picked);
                    setPickingHue(false);
                  }}
                  label={facts.kid ? "Color of this agent's family" : "Agent color"}
                />
              </PopoverPopup>
            </Popover>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-medium", regeneratingTitle && "opacity-55")}>
                {facts.title || "Untitled thread"}
              </p>
              {worktreeLabel !== null ? (
                <p className="truncate text-muted-foreground text-xs">{worktreeLabel}</p>
              ) : null}
            </div>
            {readEnvironmentSupportsTitleRegeneration(facts.ref.environmentId) ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={regeneratingTitle ? "Regenerating title" : "Regenerate title"}
                title={regeneratingTitle ? "Regenerating title…" : "Regenerate title"}
                disabled={regeneratingTitle}
                onClick={() => void regenerateTitle()}
              >
                <RefreshCwIcon className={cn(regeneratingTitle && "animate-spin")} />
              </Button>
            ) : null}
            {isStoppable(facts) ? (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Stop this run"
                title="Stop this run"
                disabled={state.phase === "stopping"}
                onClick={() => void stop()}
              >
                <SquareIcon className="fill-destructive text-destructive" />
              </Button>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    ref={archiveButton}
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Archive this thread"
                    aria-keyshortcuts="Alt+A"
                    disabled={state.phase === "archiving"}
                    onClick={() => void archive()}
                  />
                }
              >
                <ArchiveIcon />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <span className="flex items-center gap-2">
                  Archive this thread <Kbd>{ARCHIVE_SHORTCUT}</Kbd>
                </span>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Open full chat"
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    onClick={expand}
                  />
                }
              >
                <MessagesSquareIcon />
              </TooltipTrigger>
              <TooltipPopup side="top">
                <span className="flex items-center gap-2">
                  Open full chat <Kbd>{EXPAND_SHORTCUT}</Kbd>
                </span>
              </TooltipPopup>
            </Tooltip>
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          </div>
          {/* The last exchange as the chat shows it: yours in a bubble on the right, then everything
              the agent did after it. Capped in height: the turn scrolls under your message, which
              stays pinned on top. Ruled off below, edge to edge, like the header; gone while empty. */}
          <div
            ref={exchange}
            onScroll={(event) => {
              const element = event.currentTarget;
              setExchangeScrolled(element.scrollTop > 0);
              followingEnd.current =
                element.scrollHeight - element.scrollTop - element.clientHeight < 4;
            }}
            className="-mx-2.5 mt-1 max-h-80 overflow-y-auto border-b border-border px-2.5 pb-2.5 text-bubble has-[>[data-exchange]:empty]:hidden"
          >
            <div ref={exchangeContent} data-exchange className="flex min-w-0 flex-col gap-2">
              {lastSent !== null ? (
                // Covers the turn scrolling under it, which fades out beneath it.
                <div className="sticky top-0 z-10 flex flex-col items-end gap-0.5 bg-popover">
                  {/* A fractional scroll offset can leak a row of the turn above the pin; this caps it. */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-full h-1 bg-popover" />
                  {exchangeScrolled ? (
                    <div className="pointer-events-none absolute inset-x-0 top-full h-10 bg-linear-to-b from-popover to-transparent" />
                  ) : null}
                  <div
                    className="max-w-[85%] rounded-lg bg-message px-3 py-2 break-words text-message-foreground"
                    aria-label="Your last message"
                  >
                    <RollingSwap swapKey={lastSent.id}>
                      {lastSent.text === ATTACHMENT_ONLY_BOOTSTRAP_PROMPT ? (
                        <span className="line-clamp-2">
                          {`${lastSent.attachments.length} ${lastSent.attachments.length === 1 ? "attachment" : "attachments"}`}
                        </span>
                      ) : (
                        <ClampedUserMessage message={lastSent} chips={chips} />
                      )}
                    </RollingSwap>
                  </div>
                  {lastSent.queued !== null ? (
                    <QueuedSendActions threadRef={facts.ref} queued={lastSent.queued} />
                  ) : null}
                </div>
              ) : null}
              <LatestTurn
                threadRef={facts.ref}
                sentMessageId={lastSent?.id ?? null}
                awaitingUser={facts.status === "approval" || facts.status === "input"}
                cwd={cwd}
                workspaceRoot={project?.workspaceRoot}
                resolvedTheme={resolvedTheme}
                skills={skills}
                providers={providers ?? EMPTY_PROVIDERS}
                onOpenFullChat={expand}
              />
            </div>
          </div>
        </>
      }
    />
  );
}

/** A family's three shades side by side in a pill: head, body, legs. */
function FamilyShades({ shades }: { readonly shades: Shades | undefined }) {
  if (shades === undefined) return null;
  return (
    <span className="flex h-3 w-6 overflow-hidden rounded-full">
      {[shades.light, shades.base, shades.dark].map((shade) => (
        <span key={shade} className="flex-1" style={{ backgroundColor: shade }} />
      ))}
    </span>
  );
}

/** Under a message that waits for the agent's current run: steer it in now, or take it back. */
function QueuedSendActions({
  threadRef,
  queued,
}: {
  readonly threadRef: CharacterFacts["ref"];
  readonly queued: QueuedSend;
}) {
  const promote = useAtomCommand(threadEnvironment.promoteQueuedRun);
  const cancel = useAtomCommand(threadEnvironment.cancelQueuedRun);
  const [busy, setBusy] = useState(false);
  const act = async (command: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await command();
    } finally {
      setBusy(false);
    }
  };
  const { environmentId, threadId } = threadRef;
  const steerTargetRunId = queued.steerTargetRunId;
  return (
    <div className="flex items-center gap-0.5 text-muted-foreground">
      <span className="px-1">Queued</span>
      {steerTargetRunId !== null ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() =>
            void act(() =>
              promote({
                environmentId,
                input: { threadId, queuedRunId: queued.runId, targetRunId: steerTargetRunId },
              }),
            )
          }
        >
          Steer
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={() =>
          void act(() => cancel({ environmentId, input: { threadId, runId: queued.runId } }))
        }
      >
        Cancel
      </Button>
    </div>
  );
}
