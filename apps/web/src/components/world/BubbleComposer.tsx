import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { LoaderIcon, MicIcon, PaperclipIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type ComposerSlashCommand, collapseExpandedComposerCursor } from "../../composer-logic";
import { useTheme } from "../../hooks/useTheme";
import { cn, isMacPlatform } from "../../lib/utils";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "../composerContextPresentation";
import { Button } from "../ui/button";
import { shouldHandleComposerAttachmentPaste } from "../chat/composerAttachmentFiles";
import {
  type ComposerCommandItem,
  ComposerCommandMenu,
  composerSuggestionOptionId,
} from "../chat/ComposerCommandMenu";
import { BubbleAttachmentList } from "./BubbleAttachmentList";
import type { useBubbleAttachments } from "./useBubbleAttachments";
import { type BubbleSlashCommand, useBubbleSuggestions } from "./useBubbleSuggestions";
import { useVoiceInput, voiceInputSupported } from "./useVoiceInput";
import { VoiceKeyDialog } from "./VoiceKeyDialog";

/** The suggestion list's full height, and the gap it keeps from the window's edge. */
const MENU_PREFERRED_HEIGHT = 300;
const MENU_VIEWPORT_MARGIN = 12;

const NO_SLASH_COMMANDS: ReadonlyArray<BubbleSlashCommand> = [];

// The mic button held this long is push to talk: letting go ends the take.
const HOLD_TO_TALK_MS = 300;
// Cmd+Shift (Ctrl+Shift off the Mac) held this long with no other key is push to talk,
// so shortcuts that start with those keys still work.
const TALK_KEYS_HOLD_MS = 250;
const MODIFIER_KEYS = new Set(["Meta", "Control", "Shift", "Alt"]);

/** The caret at the end of the text, counted the way the editor counts it. */
const endOf = (text: string) => collapseExpandedComposerCursor(text, text.length);

/**
 * The parts every world bubble shares: the frame (Escape stops listening or closes, files drop
 * anywhere on it), the chat's text box with its `@` file, `/` command and `$`
 * skill suggestions, paste and Enter, staged files, the status
 * line, and the attach, voice and send buttons. A bubble adds its own header
 * and extras; change shared behaviour here so both bubbles keep it.
 */
export function BubbleComposer(props: {
  readonly environmentId: EnvironmentId;
  /** Where the agent works, for `@` file suggestions; null leaves them out. */
  readonly cwd: string | null;
  /** The provider the message goes to, for its `/` commands and `$` skills. */
  readonly provider: ServerProvider | null;
  /** Built-in `/` commands the bubble handles itself, such as `/plan`. */
  readonly slashCommands?: ReadonlyArray<BubbleSlashCommand>;
  readonly onSlashCommand?: (command: ComposerSlashCommand) => void;
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
  readonly hint?: string;
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
  /** A slimmer frame, for the new-agent bubble. */
  readonly narrow?: boolean;
  /** Shown between the staged files and the status line. */
  readonly children?: ReactNode;
  /**
   * Takes the status line's place beside the buttons; the status then shows
   * on its own line above, only while there is something to say.
   */
  readonly footerStart?: ReactNode;
}) {
  const { attachments, text, onTextChange, onSubmit, onError, error, busy } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const latestText = useRef(text);
  useEffect(() => {
    latestText.current = text;
  }, [text]);
  const frame = useRef<HTMLDivElement>(null);
  const editor = useRef<ComposerPromptEditorHandle>(null);
  const [cursor, setCursor] = useState(() => endOf(text));
  // Text set from outside the editor (voice, a pick) leaves the caret at its end.
  const replaceText = (next: string, nextCursor = endOf(next)) => {
    latestText.current = next;
    onTextChange(next);
    setCursor(nextCursor);
  };
  // A kept draft comes back selected: type over it or keep going.
  useEffect(() => {
    editor.current?.focusAtEnd();
    const editable = frame.current?.querySelector<HTMLElement>("[contenteditable='true']");
    if (editable && latestText.current !== "") window.getSelection()?.selectAllChildren(editable);
  }, []);

  const { resolvedTheme } = useTheme();
  const suggestionListId = useId();
  const suggestions = useBubbleSuggestions({
    environmentId: props.environmentId,
    cwd: props.cwd,
    provider: props.provider,
    slashCommands: props.slashCommands ?? NO_SLASH_COMMANDS,
    onSlashCommand: (command) => props.onSlashCommand?.(command),
  });
  // Below the text field when there's room, else above; picked when the list opens so it
  // doesn't jump while narrowing.
  const field = useRef<HTMLDivElement>(null);
  const [menuPlacement, setMenuPlacement] = useState<{
    readonly side: "below" | "above";
    readonly maxHeight: number;
  } | null>(null);
  useLayoutEffect(() => {
    const rect = field.current?.getBoundingClientRect();
    if (!suggestions.open || rect === undefined) {
      setMenuPlacement(null);
      return;
    }
    const below = window.innerHeight - rect.bottom - MENU_VIEWPORT_MARGIN;
    const above = rect.top - MENU_VIEWPORT_MARGIN;
    const side = below >= MENU_PREFERRED_HEIGHT || below >= above ? "below" : "above";
    setMenuPlacement({
      side,
      maxHeight: Math.min(MENU_PREFERRED_HEIGHT, side === "below" ? below : above),
    });
  }, [suggestions.open]);

  const pick = (item: ComposerCommandItem) => {
    const next = suggestions.select(item, latestText.current);
    if (next === null) return;
    const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
    replaceText(next.text, nextCursor);
    window.requestAnimationFrame(() => editor.current?.focusAt(nextCursor));
  };

  // Speech lands after whatever was typed; a voice command sends it at the end.
  const typedBeforeVoice = useRef("");
  const withSpeech = (heard: string) =>
    [typedBeforeVoice.current.trimEnd(), heard.trim()].filter((part) => part !== "").join(" ");
  const sendWhenHeard = useRef(false);
  const voice = useVoiceInput(props.environmentId, {
    onText: (heard) => replaceText(withSpeech(heard)),
    onDone: (heard) => {
      if (sendWhenHeard.current && heard.trim() !== "") onSubmit(withSpeech(heard));
    },
    onError,
  });
  const listening = voice.phase === "listening";
  // Set while the mic button or the talk keys are held down.
  const [talkHeld, setTalkHeld] = useState(false);
  // What is going on right now; null when the bubble is idle.
  const status = props.notice
    ? props.notice
    : listening
      ? talkHeld
        ? "Listening… let go to finish"
        : "Listening…"
      : voice.phase === "transcribing"
        ? "Transcribing…"
        : error !== null
          ? error
          : attachments.preparing
            ? "Preparing image…"
            : busy && props.busyStatus
              ? props.busyStatus
              : null;
  const startListening = (sendWhenDone: boolean, hold = false) => {
    if (voice.phase !== "idle") return;
    typedBeforeVoice.current = latestText.current;
    sendWhenHeard.current = sendWhenDone;
    onError(null);
    voice.start({ hold });
  };
  // Drops the take and puts back what was typed before it.
  const dropSpeech = () => {
    voice.cancel();
    setTalkHeld(false);
    replaceText(typedBeforeVoice.current);
    editor.current?.focusAtEnd();
  };
  const canTalk = () => voiceInputSupported() && voice.phase === "idle" && !busy;

  // A press on the mic starts listening. Held, letting go ends the take; tapped, the
  // take ends on a pause, or on the next press.
  const micPressedAt = useRef<number | null>(null);
  const releaseMic = () => {
    const pressedAt = micPressedAt.current;
    if (pressedAt === null) return;
    micPressedAt.current = null;
    setTalkHeld(false);
    if (performance.now() - pressedAt >= HOLD_TO_TALK_MS) voice.stop();
    else voice.endOnPause();
  };

  // Holding Cmd+Shift (Ctrl+Shift off the Mac) while the bubble has focus is push to talk.
  const mac = isMacPlatform(navigator.platform);
  const talkKeysLabel = mac ? "⌘⇧" : "Ctrl+Shift";
  const startKeyTalk = useEffectEvent(() => {
    if (!canTalk() || !frame.current?.contains(document.activeElement)) return false;
    setTalkHeld(true);
    startListening(false, true);
    return true;
  });
  const endKeyTalk = useEffectEvent((keep: boolean) => {
    if (!keep) {
      dropSpeech();
      return;
    }
    setTalkHeld(false);
    voice.stop();
  });
  useEffect(() => {
    const talkKeys = (event: KeyboardEvent) =>
      event.shiftKey &&
      !event.altKey &&
      (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
    let timer: number | undefined;
    let talking = false;
    const disarm = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      disarm();
      if (talking) {
        // Any other key makes it a shortcut, not speech.
        if (MODIFIER_KEYS.has(event.key)) return;
        talking = false;
        endKeyTalk(false);
        return;
      }
      if (event.repeat || !MODIFIER_KEYS.has(event.key) || !talkKeys(event)) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        talking = startKeyTalk();
      }, TALK_KEYS_HOLD_MS);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (talkKeys(event)) return;
      disarm();
      if (!talking) return;
      talking = false;
      endKeyTalk(true);
    };
    // Keys let go in another window never come back as keyup.
    const onBlur = () => {
      disarm();
      if (!talking) return;
      talking = false;
      endKeyTalk(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      disarm();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [mac]);
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
      ref={frame}
      // Focusable, so a click anywhere in the bubble keeps the keyboard here and Escape still works.
      tabIndex={-1}
      className={cn(
        "flex w-108 flex-col gap-2 rounded-xl border border-border bg-popover p-2.5 outline-none",
        props.narrow && "w-96",
        "text-popover-foreground shadow-lg",
        dropping && "border-primary",
      )}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        // The text editor (ProseMirror) prevents every Escape; its menus also stop the event,
        // so one that gets here from the editor was not used.
        const fromEditor = event.target instanceof Element && event.target.closest(".ProseMirror");
        if (event.defaultPrevented && !fromEditor) return;
        // Popups rendered elsewhere (pickers, selects, dialogs) close themselves on Escape.
        if (!event.currentTarget.contains(event.target as Node)) return;
        event.preventDefault();
        // Handled here, so the world's own Escape (closing the chat panel) leaves it alone.
        event.stopPropagation();
        // While listening, Escape drops the take and puts back what was typed before it.
        if (listening) {
          micPressedAt.current = null;
          dropSpeech();
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
      {/* Above the rest of the bubble, whose picker icons stack at z-30, so the list covers them. */}
      <div ref={field} className="relative z-40">
        {/* Framed like a text field; the placeholder lines up inside the padding. */}
        <div className="rounded-lg border border-input bg-background px-2.5 py-1.5 shadow-xs/5 focus-within:border-ring focus-within:ring-3 focus-within:ring-inset focus-within:ring-ring/24 dark:bg-input/32">
          <ComposerPromptEditor
            editorRef={editor}
            value={text}
            cursor={cursor}
            richTextEnabled
            contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
            skills={props.provider?.skills ?? []}
            disabled={busy}
            placeholder={props.placeholder}
            ariaLabel={props.inputLabel}
            suggestionListId={suggestionListId}
            activeSuggestionId={
              suggestions.activeItem === null
                ? undefined
                : composerSuggestionOptionId(suggestionListId, suggestions.activeItem.id)
            }
            className="max-h-40 min-h-12 overflow-y-auto"
            onChange={(nextValue, nextCursor, expandedCursor, besideChip) => {
              latestText.current = nextValue;
              onTextChange(nextValue);
              setCursor(nextCursor);
              suggestions.textChanged(nextValue, expandedCursor, besideChip);
              if (error !== null) onError(null);
            }}
            onCommandKeyDown={(key, event) => {
              if (event.isComposing) return false;
              if (suggestions.open) {
                if (key === "Escape") {
                  suggestions.dismiss();
                  return true;
                }
                if ((key === "ArrowUp" || key === "ArrowDown") && suggestions.items.length > 0) {
                  suggestions.moveHighlight(key);
                  return true;
                }
                if (
                  (key === "Enter" || key === "Tab") &&
                  !event.shiftKey &&
                  suggestions.activeItem
                ) {
                  pick(suggestions.activeItem);
                  return true;
                }
              }
              if (key !== "Enter" || event.shiftKey) return false;
              if ((event.metaKey || event.ctrlKey) && props.onExpand) props.onExpand();
              else onSubmit(latestText.current);
              return true;
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.files);
              const plainText = event.clipboardData.getData("text/plain");
              if (!shouldHandleComposerAttachmentPaste({ files, plainText })) return;
              event.preventDefault();
              void attach(files);
            }}
          />
        </div>
        {suggestions.open && menuPlacement !== null ? (
          // Floats over the bubble from the text field, inside the bubble so it moves with it
          // and clicks on it count as inside.
          <div
            className={cn(
              "absolute inset-x-0 overflow-hidden rounded-xl border border-border bg-popover shadow-lg",
              "[&_[data-composer-command-drawer]]:max-h-(--menu-max-height) [&_[data-composer-command-drawer]]:pb-0 [&_[data-composer-command-drawer]]:before:hidden",
              menuPlacement.side === "below" ? "top-full mt-1" : "bottom-full mb-1",
            )}
            style={{ "--menu-max-height": `${menuPlacement.maxHeight}px` } as CSSProperties}
          >
            <ComposerCommandMenu
              listId={suggestionListId}
              items={suggestions.items}
              resolvedTheme={resolvedTheme}
              isLoading={suggestions.isLoading}
              triggerKind={suggestions.trigger?.kind ?? null}
              activeItemId={suggestions.activeItem?.id ?? null}
              onHighlightedItemChange={suggestions.highlightItem}
              onSelect={pick}
            />
          </div>
        ) : null}
      </div>
      <BubbleAttachmentList
        attachments={attachments.attachments}
        disabled={busy}
        onRemove={attachments.remove}
      />
      {props.children}
      {props.footerStart !== undefined && status !== null ? (
        <span className="truncate text-xs text-muted-foreground">{status}</span>
      ) : null}
      <div className="flex items-center gap-2">
        {props.footerStart !== undefined ? (
          <div className="min-w-0 flex-1">{props.footerStart}</div>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {status ?? props.hint}
          </span>
        )}
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
          title={
            listening
              ? "Stop listening"
              : `${props.speakLabel} (hold to talk, or hold ${talkKeysLabel})`
          }
          aria-pressed={listening}
          disabled={!voiceInputSupported() || voice.phase === "transcribing" || busy}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (listening) {
              voice.stop();
              return;
            }
            if (!canTalk()) return;
            // Letting go outside the button still ends the take.
            event.currentTarget.setPointerCapture(event.pointerId);
            micPressedAt.current = performance.now();
            setTalkHeld(true);
            startListening(false, true);
          }}
          onPointerUp={releaseMic}
          onPointerCancel={releaseMic}
          onClick={(event) => {
            // Pointers are handled on press; this is Enter or Space on the focused button.
            if (event.detail !== 0) return;
            if (listening) voice.stop();
            else startListening(false);
          }}
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
