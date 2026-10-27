import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import type * as DateTime from "effect/DateTime";
import type {
  ChatAttachment,
  MessageId,
  OrchestrationMessageContext,
  OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";

export interface SentMessage {
  readonly id: MessageId;
  readonly text: string;
  /** The chips' records, for rendering them inline as the chat does. */
  readonly context: OrchestrationMessageContext | undefined;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly createdAt: DateTime.Utc;
}

export interface LastExchange {
  /**
   * The last message you wrote that the agent took up, not one an agent or the system posted
   * for you. Queued messages wait in the queue above the text box instead.
   */
  readonly sent: SentMessage | null;
}

export function lastExchange(projection: OrchestrationV2ThreadProjection): LastExchange {
  const { messages } = projection;
  // Still queued, or cancelled before it ran and so taken back: the one before it shows instead.
  const notTakenUp = new Set([
    ...projection.runs
      .filter((run) => run.status === "cancelled" && run.startedAt === null)
      .map((run) => run.userMessageId),
    ...deriveThreadQueueWorkflowState(projection).queuedRuns.map(({ messageId }) => messageId),
  ]);
  const sentMessage = messages.findLast(
    (candidate) =>
      candidate.role === "user" && candidate.createdBy === "user" && !notTakenUp.has(candidate.id),
  );
  return {
    sent:
      sentMessage === undefined
        ? null
        : {
            id: sentMessage.id,
            text: sentMessage.text,
            context: sentMessage.context,
            attachments: sentMessage.attachments,
            createdAt: sentMessage.createdAt,
          },
  };
}
