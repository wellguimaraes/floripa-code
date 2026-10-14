import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ArchiveIcon, MessagesSquareIcon, RefreshCwIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadActions } from "../../hooks/useThreadActions";
import { formatShortcutLabel } from "../../keybindings";
import { cn, newMessageId } from "../../lib/utils";
import {
  readEnvironmentSupportsTitleRegeneration,
  useProject,
  useServerConfigs,
  useThreadShell,
} from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../chat/composerPromptHistory";
import { BubbleComposer } from "./BubbleComposer";
import type { CharacterFacts } from "./engine/facts";
import { HuePicker } from "./HuePicker";
import { palette } from "./scene/palette";
import { useBubbleAttachments } from "./useBubbleAttachments";
import { ARCHIVE_SHORTCUT, useArchiveShortcut } from "./useArchiveShortcut";
import { replyPreview } from "./lastExchange";
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
  const provider =
    useServerConfigs()
      .get(facts.ref.environmentId)
      ?.providers.find((candidate) => candidate.instanceId === thread?.modelSelection.instanceId) ??
    null;
  const { sent: lastSent, reply: lastReply } = useLastExchange(facts.ref);
  const preview = lastReply === null ? null : replyPreview(lastReply.text);
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
      if (keepDraft.current && latestText.current.trim() !== "") {
        unsentDrafts.set(facts.key, latestText.current);
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
      outgoing = await attachments.prepareForSend();
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
          text: message || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
          attachments: outgoing,
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
      hint={`Enter to send · ${EXPAND_SHORTCUT} to open full chat`}
      error={state.phase === "error" ? state.message : null}
      onError={showError}
      busy={state.phase === "sending"}
      busyStatus={attachments.attachments.length > 0 ? "Uploading…" : null}
      notice={state.phase === "stopping" ? "Stopping…" : null}
      submitBlocked={thread === null}
      listenOnOpen={listen}
      header={
        <>
          <div className="-mx-2.5 flex justify-end gap-2 border-b border-border px-2.5 pb-2">
            {/* Subagents share the family colour, so a kid repaints its parent and siblings too. */}
            <Popover open={pickingHue} onOpenChange={setPickingHue}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label="Change color"
                    title="Change color"
                    className="mr-auto"
                  />
                }
              >
                <span className="text-muted-foreground">Color</span>
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: palette.families[hue]?.base }}
                />
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
          {/* Below the actions, so the title gets the bubble's full width. */}
          <span
            className={cn("text-sm font-medium break-words", regeneratingTitle && "opacity-55")}
          >
            {facts.title || "Untitled thread"}
          </span>
          {/* The last exchange as a messaging-app thread: yours on the right, the agent's on the left. */}
          {lastSent !== null || preview !== null ? (
            // The title's line-height leaves 3px of slack under its glyphs; pull up by that much so
            // the gap above matches the gap below.
            <div className="-mt-[3px] flex flex-col gap-1 text-xs">
              {lastSent !== null ? (
                <p
                  className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-1.5 break-words text-primary-foreground"
                  aria-label="Your last message"
                >
                  {/* Clamp on an inner span: overflow clips at the padding edge, so clamping the padded
                      element lets the third line peek through the bottom padding. */}
                  <span className="line-clamp-2">
                    {lastSent.text === ATTACHMENT_ONLY_BOOTSTRAP_PROMPT
                      ? `${lastSent.attachmentCount} ${lastSent.attachmentCount === 1 ? "attachment" : "attachments"}`
                      : lastSent.text}
                  </span>
                </p>
              ) : null}
              {/* The agent's answer: its opening and closing lines, the middle folded away. */}
              {preview !== null ? (
                <div
                  className="mr-auto flex max-w-[85%] min-w-0 flex-col rounded-2xl rounded-bl-md bg-accent px-3 py-1.5 text-foreground dark:bg-background"
                  aria-label="Agent's last reply"
                >
                  {preview.head.map((line) => (
                    <span key={line.key} className="truncate">
                      {line.text}
                    </span>
                  ))}
                  {preview.skipped > 0 ? (
                    <span className="text-muted-foreground">
                      … {preview.skipped} more {preview.skipped === 1 ? "line" : "lines"}
                    </span>
                  ) : null}
                  {preview.tail.map((line) => (
                    <span key={line.key} className="truncate">
                      {line.text}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      }
    />
  );
}
