import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";

export interface SentMessage {
  readonly id: string;
  readonly text: string;
  readonly attachmentCount: number;
}

export interface AgentReply {
  readonly id: string;
  readonly text: string;
}

export interface LastExchange {
  /** The last message you wrote, not one an agent or the system posted for you. */
  readonly sent: SentMessage | null;
  /** The agent's latest finished reply after it; null while it has not answered yet. */
  readonly reply: AgentReply | null;
}

export function lastExchange(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): LastExchange {
  const sentIndex = messages.findLastIndex(
    (candidate) => candidate.role === "user" && candidate.createdBy === "user",
  );
  const sentMessage = sentIndex === -1 ? undefined : messages[sentIndex];
  // Streaming replies wait until they finish, so a reply doesn't re-render on every token.
  const replyMessage = messages
    .slice(sentIndex + 1)
    .findLast(
      (candidate) =>
        candidate.role === "assistant" && !candidate.streaming && candidate.text.trim() !== "",
    );
  return {
    sent:
      sentMessage === undefined
        ? null
        : {
            id: sentMessage.id,
            text: sentMessage.text,
            attachmentCount: sentMessage.attachments.length,
          },
    reply: replyMessage === undefined ? null : { id: replyMessage.id, text: replyMessage.text },
  };
}

const PREVIEW_EDGE_LINES = 2;

/**
 * A reply cut down to its first and last two non-blank lines, with markdown markers
 * dropped. `skipped` counts the lines left out between them.
 */
export interface PreviewLine {
  /** The line's position among the kept lines; stable for a given reply. */
  readonly key: number;
  readonly text: string;
}

export function replyPreview(text: string): {
  readonly head: ReadonlyArray<PreviewLine>;
  readonly tail: ReadonlyArray<PreviewLine>;
  readonly skipped: number;
} {
  const lines = text
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?)/, "")
        .replaceAll(/\*\*|__|`/g, "")
        .trim(),
    )
    .filter((line) => line !== "" && !/^(-{3,}|\|?[\s:|-]+\|[\s:|-]*)$/.test(line))
    // Table rows read as their cells.
    .map((line) =>
      line.startsWith("|")
        ? line
            .split("|")
            .map((cell) => cell.trim())
            .filter((cell) => cell !== "")
            .join(" · ")
        : line,
    )
    .map((line, key): PreviewLine => ({ key, text: line }));
  if (lines.length <= PREVIEW_EDGE_LINES * 2 + 1) return { head: lines, tail: [], skipped: 0 };
  return {
    head: lines.slice(0, PREVIEW_EDGE_LINES),
    tail: lines.slice(-PREVIEW_EDGE_LINES),
    skipped: lines.length - PREVIEW_EDGE_LINES * 2,
  };
}
