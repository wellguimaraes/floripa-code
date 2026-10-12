import type { EnvironmentId } from "@t3tools/contracts";
import { LoaderIcon, MicIcon, PaperclipIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { shouldHandleComposerAttachmentPaste } from "../chat/composerAttachmentFiles";
import { BubbleAttachmentList } from "./BubbleAttachmentList";
import type { useBubbleAttachments } from "./useBubbleAttachments";
import { useVoiceInput, voiceInputSupported } from "./useVoiceInput";
import { VoiceKeyDialog } from "./VoiceKeyDialog";

/**
 * The parts every world bubble shares: the frame (Escape stops listening or closes, files drop
 * anywhere on it), the text box with paste and Enter, staged files, the status
 * line, and the attach, voice and send buttons. A bubble adds its own header
 * and extras; change shared behaviour here so both bubbles keep it.
 */
export function BubbleComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReturnType<typeof useBubbleAttachments>;
  readonly text: string;
  readonly onTextChange: (text: string) => void;
  /** Called with the text to send: what was typed, or what was said for a voice command. */
  readonly onSubmit: (text: string) => void;
  /** Cmd/Ctrl+Enter: leave the bubble for the full chat, taking the text along. */
  readonly onExpand?: () => void;
  readonly onClose: () => void;
  readonly placeholder: string;
  readonly inputLabel: string;
  readonly submitLabel: string;
  readonly speakLabel: string;
  /** The status line when nothing else is going on, such as "Enter to send". */
  readonly hint: string;
  /** Owned by the bubble, so its own failures and the composer's share one line. */
  readonly error: string | null;
  readonly onError: (message: string | null) => void;
  /** Sending or starting: inputs lock until it is done. */
  readonly busy: boolean;
  readonly busyStatus?: string | null;
  /** A bubble-level action in progress, shown above everything else. */
  readonly notice?: string | null;
  /** Something besides the text is missing, so sending can't happen yet. */
  readonly submitBlocked?: boolean;
  /** Start listening at once and send what was said: a voice command. */
  readonly listenOnOpen?: boolean;
  readonly header: ReactNode;
  /** Shown between the staged files and the status line. */
  readonly children?: ReactNode;
}) {
  const { attachments, text, onTextChange, onSubmit, onError, error, busy } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  }, [text]);
  const textarea = useRef<HTMLTextAreaElement>(null);
  // A kept draft comes back selected: type over it or keep going.
  useEffect(() => {
    textarea.current?.select();
  }, []);

  // Speech lands after whatever was typed; a voice command sends it at the end.
  const typedBeforeVoice = useRef("");
  const withSpeech = (heard: string) =>
    [typedBeforeVoice.current.trimEnd(), heard.trim()].filter((part) => part !== "").join(" ");
  const sendWhenHeard = useRef(false);
  const voice = useVoiceInput(props.environmentId, {
    onText: (heard) => onTextChange(withSpeech(heard)),
    onDone: (heard) => {
      if (sendWhenHeard.current && heard.trim() !== "") onSubmit(withSpeech(heard));
    },
    onError,
  });
  const listening = voice.phase === "listening";
  const startListening = (sendWhenDone: boolean) => {
    if (voice.phase !== "idle") return;
    typedBeforeVoice.current = latestText.current;
    sendWhenHeard.current = sendWhenDone;
    onError(null);
    voice.start();
  };
  const listenOnOpen = useEffectEvent(() => {
    if (props.listenOnOpen) startListening(true);
  });
  useEffect(() => {
    listenOnOpen();
  }, []);

  const attach = async (files: ReadonlyArray<File>) => {
    if (files.length === 0) return;
    onError(null);
    const failure = await attachments.add(files);
    if (failure !== null) onError(failure);
  };

  return (
    <div
      // Focusable, so a click anywhere in the bubble keeps the keyboard here and Escape still works.
      tabIndex={-1}
      className={cn(
        "flex w-72 flex-col gap-2 rounded-xl border border-border bg-popover p-2.5 outline-none",
        "text-popover-foreground shadow-lg",
        dropping && "border-primary",
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // Popups rendered elsewhere (pickers, selects, dialogs) close themselves on Escape.
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        // While listening, Escape drops the take and puts back what was typed before it.
        if (listening) {
          voice.cancel();
          onTextChange(typedBeforeVoice.current);
          textarea.current?.focus();
          return;
        }
        props.onClose();
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
      {props.header}
      <Textarea
        size="sm"
        ref={textarea}
        autoFocus
        value={text}
        placeholder={props.placeholder}
        aria-label={props.inputLabel}
        onChange={(event) => {
          onTextChange(event.target.value);
          if (error !== null) onError(null);
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
            if ((event.metaKey || event.ctrlKey) && props.onExpand) props.onExpand();
            else onSubmit(text);
          }
        }}
      />
      <BubbleAttachmentList
        attachments={attachments.attachments}
        disabled={busy}
        onRemove={attachments.remove}
      />
      {props.children}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {props.notice
            ? props.notice
            : listening
              ? "Listening…"
              : voice.phase === "transcribing"
                ? "Transcribing…"
                : error !== null
                  ? error
                  : attachments.preparing
                    ? "Preparing image…"
                    : busy && props.busyStatus
                      ? props.busyStatus
                      : props.hint}
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
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <PaperclipIcon />
        </Button>
        <Button
          variant={listening ? "destructive" : "ghost"}
          size="icon-sm"
          aria-label={
            !voiceInputSupported()
              ? "Voice input isn't available here"
              : listening
                ? "Stop listening"
                : props.speakLabel
          }
          title={listening ? "Stop listening" : props.speakLabel}
          aria-pressed={listening}
          disabled={!voiceInputSupported() || voice.phase === "transcribing" || busy}
          onClick={() => (listening ? voice.stop() : startListening(false))}
        >
          {voice.phase === "transcribing" ? (
            <LoaderIcon className="animate-spin" />
          ) : listening ? (
            <SquareIcon className="fill-white text-white" />
          ) : (
            <MicIcon />
          )}
        </Button>
        <Button
          size="icon-sm"
          aria-label={props.submitLabel}
          disabled={
            (text.trim() === "" && attachments.attachments.length === 0) ||
            attachments.preparing ||
            busy ||
            props.submitBlocked === true
          }
          onClick={() => onSubmit(text)}
        >
          <SendHorizontalIcon />
        </Button>
      </div>
      {voice.keyPrompt !== null ? (
        <VoiceKeyDialog
          environmentId={props.environmentId}
          reason={voice.keyPrompt}
          onClose={voice.dismissKeyPrompt}
          onSaved={voice.keySaved}
        />
      ) : null}
    </div>
  );
}
