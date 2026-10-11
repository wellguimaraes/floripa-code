import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ArchiveIcon, Maximize2Icon, MicIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useThreadActions } from "../../hooks/useThreadActions";
import { newMessageId } from "../../lib/utils";
import { useThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import type { CharacterFacts } from "./engine/facts";

const STATUS_LABEL: Record<CharacterFacts["status"], string> = {
  working: "Mining",
  waiting: "Waiting",
  approval: "Needs your approval",
  input: "Has a question for you",
  ready: "Done",
  failed: "Run failed",
  limited: "Hit a usage limit",
};

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
}) {
  const { facts, onClose, onExpand, onArchived } = props;
  const { archiveThread } = useThreadActions();
  const thread = useThreadShell(facts.ref);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const [text, setText] = useState("");
  const [state, setState] = useState<
    | { readonly phase: "idle" | "sending" | "sent" | "archiving" }
    | { readonly phase: "error"; message: string }
  >({ phase: "idle" });
  const status =
    facts.status === "working" && facts.quiet
      ? "Thinking, no new output"
      : STATUS_LABEL[facts.status];

  const send = async () => {
    const message = text.trim();
    if (message === "" || thread === null || state.phase === "sending") return;
    setState({ phase: "sending" });
    const result = await startTurn({
      environmentId: facts.ref.environmentId,
      input: {
        threadId: facts.ref.threadId,
        message: { messageId: newMessageId(), role: "user", text: message, attachments: [] },
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
    setText("");
    setState({ phase: "sent" });
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
    onArchived();
  };

  const expand = () => {
    // Carry the unsent text into the full chat's composer.
    if (text.trim() !== "") {
      useComposerDraftStore
        .getState()
        .setPrompt(scopeThreadRef(facts.ref.environmentId, facts.ref.threadId), text);
    }
    onExpand();
  };

  return (
    <div className="flex w-72 flex-col gap-2 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-lg">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{facts.title || "Untitled thread"}</span>
          <span className="text-xs text-muted-foreground">{status}</span>
        </div>
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
      <Textarea
        size="sm"
        autoFocus
        value={text}
        placeholder="Message this agent"
        aria-label={`Message ${facts.title || "this agent"}`}
        onChange={(event) => {
          setText(event.target.value);
          if (state.phase === "sent" || state.phase === "error") setState({ phase: "idle" });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {state.phase === "sent"
            ? "Sent"
            : state.phase === "error"
              ? state.message
              : "Enter to send"}
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
          aria-label="Send"
          disabled={text.trim() === "" || thread === null || state.phase === "sending"}
          onClick={() => void send()}
        >
          <SendHorizontalIcon />
        </Button>
      </div>
    </div>
  );
}
