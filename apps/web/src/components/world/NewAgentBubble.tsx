import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import {
  FolderGit2Icon,
  FolderGitIcon,
  FolderIcon,
  LoaderIcon,
  MicIcon,
  PaperclipIcon,
  SendHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { shouldHandleComposerAttachmentPaste } from "../chat/composerAttachmentFiles";
import { BubbleAttachmentList } from "./BubbleAttachmentList";
import { HuePicker } from "./HuePicker";
import { useBubbleAttachments } from "./useBubbleAttachments";
import { useVoiceInput, voiceInputSupported } from "./useVoiceInput";
import { VoiceKeyDialog } from "./VoiceKeyDialog";
import {
  useStartWorldAgent,
  useWorldAgentWorkspaces,
  type WorldAgentWorkspace,
} from "./useStartWorldAgent";

const workspaceValue = (workspace: WorldAgentWorkspace) =>
  workspace.kind === "worktree" ? `worktree:${workspace.path}` : workspace.kind;

/**
 * Starts an agent from an empty spot on an island. Enter sends the text as the
 * first message of a new thread in that project, with any attached, dropped,
 * or pasted files, using the defaults a fresh draft would; the chat stays closed.
 * In a repo it can work in the checkout, a new worktree, or an existing one.
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
  // Null until picked: the project's default applies.
  const [workspace, setWorkspace] = useState<WorldAgentWorkspace | null>(null);
  const workspaceItems: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly workspace: WorldAgentWorkspace;
  }> = [
    { value: "local", label: "Current checkout", workspace: { kind: "local" } },
    { value: "new-worktree", label: "New worktree", workspace: { kind: "new-worktree" } },
    ...workspaces.worktrees.map((worktree) => {
      const item: WorldAgentWorkspace = { kind: "worktree", ...worktree };
      return { value: workspaceValue(item), label: worktree.branch, workspace: item };
    }),
  ];
  const selectedWorkspace = workspace ?? workspaces.defaultWorkspace;
  const attachments = useBubbleAttachments(project.environmentId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [state, setState] = useState<
    { readonly phase: "idle" | "starting" } | { readonly phase: "error"; message: string }
  >({ phase: "idle" });
  const empty = text.trim() === "" && attachments.attachments.length === 0;

  // Speech lands after whatever was typed.
  const typedBeforeVoice = useRef("");
  const voice = useVoiceInput(project.environmentId, {
    onText: (heard) => {
      const next = [typedBeforeVoice.current.trimEnd(), heard.trim()]
        .filter((part) => part !== "")
        .join(" ");
      setText(next);
      onTextChange(next);
    },
    onError: (message) => setState({ phase: "error", message }),
  });
  const startListening = () => {
    typedBeforeVoice.current = text;
    if (state.phase === "error") setState({ phase: "idle" });
    voice.start();
  };

  const start = async () => {
    if (state.phase === "starting" || attachments.preparing || empty) return;
    setState({ phase: "starting" });
    try {
      const outgoing = await attachments.prepareForSend();
      const threadId = await startAgent(project, text.trim(), outgoing, workspace);
      attachments.sent();
      const ref = { environmentId: project.environmentId, threadId };
      onStarted({ key: scopedThreadKey(ref), ref, hue });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not start an agent here.",
      });
    }
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
        // Popups rendered elsewhere (workspace select, dialogs) close themselves on Escape.
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
            {selectedWorkspace.kind === "new-worktree" ? (
              <FolderGit2Icon />
            ) : selectedWorkspace.kind === "worktree" ? (
              <FolderGitIcon />
            ) : (
              <FolderIcon />
            )}
            <SelectValue />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {workspaceItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {item.workspace.kind === "new-worktree" ? (
                    <FolderGit2Icon className="size-3" />
                  ) : item.workspace.kind === "worktree" ? (
                    <FolderGitIcon className="size-3" />
                  ) : (
                    <FolderIcon className="size-3" />
                  )}
                  <span className="truncate">{item.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      <Textarea
        size="sm"
        autoFocus
        value={text}
        placeholder="What should it work on?"
        aria-label={`Task for a new agent on ${islandName}`}
        onChange={(event) => {
          setText(event.target.value);
          onTextChange(event.target.value);
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
            void start();
          }
        }}
      />
      <BubbleAttachmentList
        attachments={attachments.attachments}
        disabled={state.phase === "starting"}
        onRemove={attachments.remove}
      />
      <HuePicker hue={hue} onChange={setHue} />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {voice.phase === "listening"
            ? "Listening…"
            : voice.phase === "transcribing"
              ? "Transcribing…"
              : state.phase === "error"
                ? state.message
                : attachments.preparing
                  ? "Preparing image…"
                  : state.phase === "starting"
                    ? "Starting…"
                    : "Enter to start"}
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
          disabled={state.phase === "starting"}
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
                : "Speak the task"
          }
          title={voice.phase === "listening" ? "Stop listening" : "Speak the task"}
          aria-pressed={voice.phase === "listening"}
          disabled={
            !voiceInputSupported() || voice.phase === "transcribing" || state.phase === "starting"
          }
          onClick={() => (voice.phase === "listening" ? voice.stop() : startListening())}
        >
          {voice.phase === "transcribing" ? <LoaderIcon className="animate-spin" /> : <MicIcon />}
        </Button>
        <Button
          size="icon-sm"
          aria-label="Start"
          disabled={state.phase === "starting" || attachments.preparing || empty}
          onClick={() => void start()}
        >
          <SendHorizontalIcon />
        </Button>
      </div>
      {voice.keyPrompt !== null ? (
        <VoiceKeyDialog
          environmentId={project.environmentId}
          reason={voice.keyPrompt}
          onClose={voice.dismissKeyPrompt}
          onSaved={voice.keySaved}
        />
      ) : null}
    </div>
  );
}
