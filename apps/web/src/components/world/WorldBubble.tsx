import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { fileBasename } from "@t3tools/shared/path";
import { ArchiveIcon, MessagesSquareIcon, RefreshCwIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadActions } from "../../hooks/useThreadActions";
import { formatShortcutLabel } from "../../keybindings";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { stripInlineContextReferences } from "../../lib/composerContextReferences";
import { cn, newMessageId } from "../../lib/utils";
import {
  readEnvironmentSupportsTitleRegeneration,
  useProject,
  useServerConfigs,
  useThreadShell,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../chat/composerPromptHistory";
import { getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { BubbleComposer } from "./BubbleComposer";
import type { CharacterFacts } from "./engine/facts";
import { HuePicker } from "./HuePicker";
import { type FamilyShades as Shades, palette } from "./scene/palette";
import { useBubbleAttachments } from "./useBubbleAttachments";
import { ARCHIVE_SHORTCUT, useArchiveShortcut } from "./useArchiveShortcut";
import { BubbleMarkdown } from "./BubbleMarkdown";
import type { QueuedSend } from "./lastExchange";
import { RollingSwap, TypingDots } from "./RollingSwap";
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

/**
 * Unsent text per character, kept when the bubble closes without sending so
 * reopening it picks up where you left off.
 */
const unsentDrafts = new Map<string, string>();

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
  const { sent: lastSent, reply: lastReply } = useLastExchange(facts.ref);
  // Who answered and when, under the reply: the run's model, which may not be the thread's now.
  const replyModel = lastReply?.model ?? null;
  const replyModelOption =
    replyModel === null
      ? undefined
      : providers
          ?.find((candidate) => candidate.instanceId === replyModel.instanceId)
          ?.models.find((model) => model.slug === replyModel.model);
  const replyMeta =
    lastReply === null
      ? null
      : [
          replyModelOption !== undefined
            ? getTriggerDisplayModelName(replyModelOption)
            : replyModel?.model,
          formatRelativeTimeLabel(lastReply.at),
        ]
          .filter((part) => part !== undefined && part !== "")
          .join(" · ");
  // While the agent works its bubble shows typing dots; the finished reply rolls in after.
  const typing = facts.status === "working";
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
  const [text, setText] = useState(() => unsentDrafts.get(facts.key) ?? "");
  // Whatever is left unsent when the bubble goes away waits for next time.
  const keepDraft = useRef(true);
  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  }, [text]);
  useEffect(
    () => () => {
      // The staged files go with the bubble, so their chips don't stay in the draft.
      const kept = stripInlineContextReferences(latestText.current);
      if (keepDraft.current && kept.trim() !== "") {
        unsentDrafts.set(facts.key, kept);
      } else {
        unsentDrafts.delete(facts.key);
      }
    },
    [facts.key],
  );
  const attachments = useBubbleAttachments(facts.ref.environmentId);
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
    // Sent: the bubble has done its job.
    keepDraft.current = false;
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
    keepDraft.current = false;
    onArchived();
  };

  useArchiveShortcut(archive);

  const expand = () => {
    // Carry the unsent text and files into the full chat's composer.
    const draft = scopeThreadRef(facts.ref.environmentId, facts.ref.threadId);
    if (text.trim() !== "") useComposerDraftStore.getState().setPrompt(draft, text);
    attachments.handOff(draft);
    keepDraft.current = false;
    onExpand();
  };

  return (
    <BubbleComposer
      environmentId={facts.ref.environmentId}
      cwd={thread?.worktreePath ?? project?.workspaceRoot ?? null}
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
          {/* The last exchange as a messaging-app thread: yours on the right, the agent's on the left.
              Capped in height: a long reply scrolls under your message, which stays pinned on top. */}
          {lastSent !== null || lastReply !== null || typing ? (
            // Ruled off below, edge to edge, like the header.
            <div className="-mx-2.5 mt-1 flex max-h-80 flex-col gap-2 overflow-y-auto border-b border-border px-2.5 pb-2.5 text-xs">
              {lastSent !== null ? (
                <div className="sticky top-0 z-10 flex flex-col items-end gap-0.5 bg-popover">
                  <div
                    className="max-w-[85%] rounded-lg px-3 py-2 break-words"
                    // Light in every app theme, so the text stays dark on them.
                    style={{ backgroundColor: palette.bubbleSent, color: palette.bubbleText }}
                    aria-label="Your last message"
                  >
                    {/* Clamp on an inner span: overflow clips at the padding edge, so clamping the padded
                        element lets the third line peek through the bottom padding. */}
                    <RollingSwap swapKey={lastSent.id}>
                      <span className="line-clamp-2">
                        {lastSent.text === ATTACHMENT_ONLY_BOOTSTRAP_PROMPT ? (
                          `${lastSent.attachmentCount} ${lastSent.attachmentCount === 1 ? "attachment" : "attachments"}`
                        ) : (
                          <BubbleMarkdown text={lastSent.text} />
                        )}
                      </span>
                    </RollingSwap>
                  </div>
                  {lastSent.queued !== null ? (
                    <QueuedSendActions threadRef={facts.ref} queued={lastSent.queued} />
                  ) : null}
                </div>
              ) : null}
              {/* The agent's whole answer. */}
              {typing || lastReply !== null ? (
                <div
                  className="mr-auto flex max-w-[85%] min-w-0 flex-col rounded-lg px-3 py-2"
                  style={{ backgroundColor: palette.bubbleReply, color: palette.bubbleText }}
                >
                  <RollingSwap swapKey={typing ? "typing" : (lastReply?.id ?? "typing")}>
                    {typing || lastReply === null ? (
                      <TypingDots />
                    ) : (
                      <>
                        <BubbleMarkdown text={lastReply.text} block />
                        {replyMeta ? (
                          <span className="mt-1 max-w-full self-end truncate text-xs opacity-60">
                            {replyMeta}
                          </span>
                        ) : null}
                      </>
                    )}
                  </RollingSwap>
                </div>
              ) : null}
            </div>
          ) : null}
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
