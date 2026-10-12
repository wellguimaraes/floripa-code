import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  LoaderIcon,
  Maximize2Icon,
  MicIcon,
  PaperclipIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadActions } from "../../hooks/useThreadActions";
import { cn, newMessageId } from "../../lib/utils";
import { readEnvironmentSupportsTitleRegeneration, useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { shouldHandleComposerAttachmentPaste } from "../chat/composerAttachmentFiles";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "../chat/composerPromptHistory";
import { BubbleAttachmentList } from "./BubbleAttachmentList";
import type { CharacterFacts } from "./engine/facts";
import { HuePicker } from "./HuePicker";
import { palette } from "./scene/palette";
import { useBubbleAttachments } from "./useBubbleAttachments";
import { useLastSentMessage } from "./useLastSentMessage";
import { useVoiceInput, voiceInputSupported } from "./useVoiceInput";
import { VoiceKeyDialog } from "./VoiceKeyDialog";

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

/**
 * A quick reply box beside a character: send a message without leaving the
 * world, or expand into the full chat with whatever was typed so far.
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
  const lastSent = useLastSentMessage(facts.ref);
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
  const textarea = useRef<HTMLTextAreaElement>(null);
  // A kept draft comes back selected: type over it or keep going.
  useEffect(() => {
    textarea.current?.select();
  }, []);
  const attachments = useBubbleAttachments(facts.ref.environmentId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [state, setState] = useState<
    | { readonly phase: "idle" | "sending" | "stopping" | "archiving" }
    | { readonly phase: "error"; message: string }
  >({ phase: "idle" });

  const send = async (said?: string) => {
    const message = (said ?? text).trim();
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

  // Speech lands after whatever was typed; a voice command sends it at the end.
  const typedBeforeVoice = useRef("");
  const withSpeech = (heard: string) =>
    [typedBeforeVoice.current.trimEnd(), heard.trim()].filter((part) => part !== "").join(" ");
  const sendWhenHeard = useRef(false);
  const voice = useVoiceInput(facts.ref.environmentId, {
    onText: (heard) => setText(withSpeech(heard)),
    onDone: (heard) => {
      if (sendWhenHeard.current && heard.trim() !== "") void send(withSpeech(heard));
    },
    onError: (message) => setState({ phase: "error", message }),
  });
  const startListening = (sendWhenDone: boolean) => {
    if (voice.phase !== "idle") return;
    typedBeforeVoice.current = latestText.current;
    sendWhenHeard.current = sendWhenDone;
    if (state.phase === "error") setState({ phase: "idle" });
    voice.start();
  };
  // A voice command listens as soon as the bubble opens.
  const listenOnOpen = useEffectEvent(() => {
    if (listen) startListening(true);
  });
  useEffect(() => {
    listenOnOpen();
  }, []);

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
          error instanceof Error && error.message !== ""
            ? error.message
            : "Could not archive. Stop the run first.",
      });
      return;
    }
    keepDraft.current = false;
    onArchived();
  };

  const expand = () => {
    // Carry the unsent text and files into the full chat's composer.
    const draft = scopeThreadRef(facts.ref.environmentId, facts.ref.threadId);
    if (text.trim() !== "") useComposerDraftStore.getState().setPrompt(draft, text);
    attachments.handOff(draft);
    keepDraft.current = false;
    onExpand();
  };

  const attach = async (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    if (state.phase === "error") setState({ phase: "idle" });
    const error = await attachments.add(files);
    if (error !== null) setState({ phase: "error", message: error });
  };

  return (
    <div
      // Focusable, so a click anywhere in the bubble keeps the keyboard here and Escape still closes it.
      tabIndex={-1}
      className={cn(
        "flex w-72 flex-col gap-2 rounded-xl border border-border bg-popover p-2.5 outline-none",
        "text-popover-foreground shadow-lg",
        dropping && "border-primary",
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Popups rendered elsewhere (colour picker, dialogs) close themselves on Escape.
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        onClose();
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(false);
        void attach(Array.from(event.dataTransfer.files));
      }}
    >
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
              className="size-4 rounded-full"
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
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Archive this thread"
          title="Archive this thread"
          disabled={state.phase === "archiving"}
          onClick={() => void archive()}
        >
          <ArchiveIcon />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Open full chat" onClick={expand}>
          <Maximize2Icon />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      {/* Below the actions, so the title gets the bubble's full width. */}
      <span className={cn("text-sm font-medium break-words", regeneratingTitle && "opacity-55")}>
        {facts.title || "Untitled thread"}
      </span>
      {/* What you last asked, as a reminder of where the conversation is. */}
      {lastSent !== null ? (
        <p
          // The title's line-height leaves 3px of slack under its glyphs; pull up by that much so
          // the gap above matches the gap below.
          className="-mt-[3px] line-clamp-2 rounded-md bg-accent px-2.5 py-1.5 text-xs break-words text-muted-foreground dark:bg-background"
          aria-label="Your last message"
        >
          {lastSent.text === ATTACHMENT_ONLY_BOOTSTRAP_PROMPT
            ? `${lastSent.attachmentCount} ${lastSent.attachmentCount === 1 ? "attachment" : "attachments"}`
            : lastSent.text}
        </p>
      ) : null}
      <Textarea
        size="sm"
        ref={textarea}
        autoFocus
        value={text}
        placeholder="Message this agent"
        aria-label={`Message ${facts.title || "this agent"}`}
        onChange={(event) => {
          setText(event.target.value);
          if (state.phase === "error") setState({ phase: "idle" });
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          const plainText = event.clipboardData.getData("text/plain");
          if (!shouldHandleComposerAttachmentPaste({ files, plainText })) return;
          event.preventDefault();
          void attach(files);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <BubbleAttachmentList
        attachments={attachments.attachments}
        disabled={state.phase === "sending"}
        onRemove={attachments.remove}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {state.phase === "stopping"
            ? "Stopping…"
            : voice.phase === "listening"
              ? "Listening…"
              : voice.phase === "transcribing"
                ? "Transcribing…"
                : state.phase === "error"
                  ? state.message
                  : attachments.preparing
                    ? "Preparing image…"
                    : state.phase === "sending" && attachments.attachments.length > 0
                      ? "Uploading…"
                      : "Enter to send"}
        </span>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void attach(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Attach files"
          title="Attach files"
          disabled={state.phase === "sending"}
          onClick={() => fileInput.current?.click()}
        >
          <PaperclipIcon />
        </Button>
        <Button
          variant={voice.phase === "listening" ? "default" : "ghost"}
          size="icon-sm"
          aria-label={
            !voiceInputSupported()
              ? "Voice input isn't available here"
              : voice.phase === "listening"
                ? "Stop listening"
                : "Speak a message"
          }
          title={voice.phase === "listening" ? "Stop listening" : "Speak a message"}
          aria-pressed={voice.phase === "listening"}
          disabled={!voiceInputSupported() || voice.phase === "transcribing"}
          onClick={() => (voice.phase === "listening" ? voice.stop() : startListening(false))}
        >
          {voice.phase === "transcribing" ? <LoaderIcon className="animate-spin" /> : <MicIcon />}
        </Button>
        <Button
          size="icon-sm"
          aria-label="Send"
          disabled={
            (text.trim() === "" && attachments.attachments.length === 0) ||
            attachments.preparing ||
            thread === null ||
            state.phase === "sending"
          }
          onClick={() => void send()}
        >
          <SendHorizontalIcon />
        </Button>
      </div>
      {voice.keyPrompt !== null ? (
        <VoiceKeyDialog
          environmentId={facts.ref.environmentId}
          reason={voice.keyPrompt}
          onClose={voice.dismissKeyPrompt}
          onSaved={voice.keySaved}
        />
      ) : null}
    </div>
  );
}
