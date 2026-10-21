import { deriveThreadQueueWorkflowState } from "@t3tools/client-runtime/state/thread-workflows";
import type { ModelSelection, OrchestrationV2ThreadProjection, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/** A sent message still waiting behind the agent's current run. */
export interface QueuedSend {
  readonly runId: RunId;
  /** The running run it can steer into instead; null when the provider can't steer now. */
  readonly steerTargetRunId: RunId | null;
}

export interface SentMessage {
  readonly id: string;
  readonly text: string;
  readonly attachmentCount: number;
  readonly queued: QueuedSend | null;
}

export interface AgentReply {
  readonly id: string;
  readonly text: string;
  /** When the reply finished, as an ISO timestamp. */
  readonly at: string;
  /** The model of the run that wrote it; null for a reply outside a run. */
  readonly model: ModelSelection | null;
}

export interface LastExchange {
  /** The last message you wrote, not one an agent or the system posted for you. */
  readonly sent: SentMessage | null;
  /** The agent's latest finished reply after it; null while it has not answered yet. */
  readonly reply: AgentReply | null;
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
  // Streaming replies wait until they finish, so a reply doesn't re-render on every token.
  const replyMessage = messages
    .slice(sentIndex + 1)
    .findLast(
      (candidate) =>
        candidate.role === "assistant" && !candidate.streaming && candidate.text.trim() !== "",
    );
  const queue = deriveThreadQueueWorkflowState(projection);
  const queuedRun = queue.queuedRuns.find(({ messageId }) => messageId === sentMessage?.id)?.run;
  return {
    sent:
      sentMessage === undefined
        ? null
        : {
            id: sentMessage.id,
            text: sentMessage.text,
            attachmentCount: sentMessage.attachments.length,
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
    reply:
      replyMessage === undefined
        ? null
        : {
            id: replyMessage.id,
            text: replyMessage.text,
            at: DateTime.formatIso(replyMessage.updatedAt),
            model:
              projection.runs.find((run) => run.id === replyMessage.runId)?.modelSelection ?? null,
          },
  };
}
