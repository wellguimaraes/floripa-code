import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import type {
  ChatAttachment,
  MessageId,
  OrchestrationMessageContext,
  OrchestrationV2ThreadProjection,
  RunId,
} from "@t3tools/contracts";

/** A sent message still waiting behind the agent's current run. */
export interface QueuedSend {
  readonly runId: RunId;
  /** The running run it can steer into instead; null when the provider can't steer now. */
  readonly steerTargetRunId: RunId | null;
}

export interface SentMessage {
  readonly id: MessageId;
  readonly text: string;
  /** The chips' records, for rendering them inline as the chat does. */
  readonly context: OrchestrationMessageContext | undefined;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly queued: QueuedSend | null;
}

export interface LastExchange {
  /** The last message you wrote, not one an agent or the system posted for you. */
  readonly sent: SentMessage | null;
}

export function lastExchange(projection: OrchestrationV2ThreadProjection): LastExchange {
  const { messages } = projection;
  // A queued message cancelled before it ran was taken back; the one before it shows instead.
  const withdrawn = new Set(
    projection.runs
      .filter((run) => run.status === "cancelled" && run.startedAt === null)
      .map((run) => run.userMessageId),
  );
  const sentIndex = messages.findLastIndex(
    (candidate) =>
      candidate.role === "user" && candidate.createdBy === "user" && !withdrawn.has(candidate.id),
  );
  const sentMessage = sentIndex === -1 ? undefined : messages[sentIndex];
  const queue = deriveThreadQueueWorkflowState(projection);
  const queuedRun = queue.queuedRuns.find(({ messageId }) => messageId === sentMessage?.id)?.run;
  return {
    sent:
      sentMessage === undefined
        ? null
        : {
            id: sentMessage.id,
            text: sentMessage.text,
            context: sentMessage.context,
            attachments: sentMessage.attachments,
            queued:
              queuedRun === undefined
                ? null
                : {
                    runId: queuedRun.id,
                    steerTargetRunId:
                      queue.canPromoteToSteer && queue.activeRun !== null
                        ? queue.activeRun.id
                        : null,
                  },
          },
  };
}
