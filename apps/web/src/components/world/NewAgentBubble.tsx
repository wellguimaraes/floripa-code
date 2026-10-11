import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef, ScopedThreadRef } from "@t3tools/contracts";
import { MicIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

/**
 * Starts an agent from an empty spot on an island. It opens the project's
 * regular new-thread draft with the text already typed, so model, branch and
 * worktree defaults stay the composer's; one more Enter there sends it.
 */
export function NewAgentBubble(props: {
  readonly islandName: string;
  readonly project: ScopedProjectRef;
  readonly onClose: () => void;
  /** The draft is open; `thread` is the thread it will become once sent. */
  readonly onStarted: (thread: { readonly key: string; readonly ref: ScopedThreadRef }) => void;
}) {
  const { islandName, project, onClose, onStarted } = props;
  const newThread = useNewThreadHandler();
  const [text, setText] = useState("");
  const [state, setState] = useState<
    { readonly phase: "idle" | "starting" } | { readonly phase: "error"; message: string }
  >({ phase: "idle" });

  const start = async () => {
    if (state.phase === "starting") return;
    setState({ phase: "starting" });
    try {
      const opened = await newThread(project);
      if (opened === null) {
        setState({ phase: "error", message: "Could not open a new thread here." });
        return;
      }
      if (text.trim() !== "") useComposerDraftStore.getState().setPrompt(opened.draftId, text);
      const ref = { environmentId: project.environmentId, threadId: opened.threadId };
      onStarted({ key: scopedThreadKey(ref), ref });
    } catch (error) {
      setState({
        phase: "error",
        message: error instanceof Error ? error.message : "Could not open a new thread here.",
      });
    }
  };

  return (
    <div className="flex w-72 flex-col gap-2 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-lg">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">New agent</span>
          <span className="truncate text-xs text-muted-foreground">on {islandName}</span>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <Textarea
        size="sm"
        autoFocus
        value={text}
        placeholder="What should it work on?"
        aria-label={`Task for a new agent on ${islandName}`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void start();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {state.phase === "error" ? state.message : "Opens the draft to review and send"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Voice input is not available on web yet"
          title="Voice input is not available on web yet"
          disabled
        >
          <MicIcon />
        </Button>
        <Button
          size="icon-sm"
          aria-label="Start"
          disabled={state.phase === "starting"}
          onClick={() => void start()}
        >
          <SendHorizontalIcon />
        </Button>
      </div>
    </div>
  );
}
