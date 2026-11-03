import type { ThreadContextRecord, ThreadMentionIntent } from "@t3tools/contracts";
import { threadMentionChipLabel } from "@t3tools/client-runtime/composerThreadItems";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon, SendIcon } from "lucide-react";
import type { CSSProperties } from "react";

import { isMacPlatform } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { ContextChip, ContextChipLabel } from "./ContextChip";
import { useWorldAgentColor } from "./world/worldLookStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

/**
 * Inline chip for a mentioned thread, in the composer and in sent messages. Reads
 * `@look:Title` or `@tell:Title`, preferring the live title so a renamed thread never shows a
 * stale label. With `onSetIntent` (the composer) a click switches look and tell and
 * ⌘-click opens the thread; otherwise a click opens it.
 */
export function ThreadContextChip(props: {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title" | "intent">;
  copyMarkdown?: string;
  onSetIntent?: (intent: ThreadMentionIntent) => void;
}) {
  const { environmentId, threadId } = props.record;
  const intent = props.record.intent ?? "look";
  const shell = useThreadShell({ environmentId, threadId });
  // In the world, a look chip wears the mentioned agent's colour so it reads as that character.
  // A tell chip keeps the tell accent: it marks the mention that makes another agent act.
  const agentColor = useWorldAgentColor(scopedThreadKey({ environmentId, threadId }));
  const navigate = useNavigate();
  const title = shell?.title?.trim() || props.record.title;
  const onSetIntent = props.onSetIntent;
  const openThread = () =>
    void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });
  const mod = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const tooltip = !shell
    ? "Thread no longer available"
    : onSetIntent
      ? `${intent === "tell" ? "The agent will message this thread" : "The agent will read this thread"}. Click to switch to ${intent === "tell" ? "look" : "tell"}, ${mod}-click to open.`
      : intent === "tell"
        ? "Messaged by the agent. Open thread"
        : "Open thread";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ContextChip
            kind={intent === "tell" ? "thread-tell" : "thread"}
            render={
              onSetIntent ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey) openThread();
                    else onSetIntent(intent === "tell" ? "look" : "tell");
                  }}
                />
              ) : (
                <Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />
              )
            }
            aria-label={`Thread to ${intent === "tell" ? "message" : "read"}, ${title}`}
            data-markdown-copy={props.copyMarkdown}
            className="no-underline"
            {...(agentColor && intent === "look"
              ? { style: { "--context-chip-accent": agentColor } as CSSProperties }
              : {})}
          >
            {intent === "tell" ? <SendIcon /> : <MessagesSquareIcon />}
            <ContextChipLabel>{threadMentionChipLabel(intent, title)}</ContextChipLabel>
          </ContextChip>
        }
      />
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
