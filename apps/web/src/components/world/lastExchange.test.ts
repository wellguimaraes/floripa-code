import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";

import { makeThreadProjectionFixture } from "../../test-fixtures";
import { lastExchange } from "./lastExchange";

describe("lastExchange", () => {
  const sent = (id: string) => ({ id, role: "user", createdBy: "user", text: id, attachments: [] });
  const projection = (runs: ReadonlyArray<object>, messages: ReadonlyArray<object>) =>
    ({
      ...makeThreadProjectionFixture(),
      runs,
      messages,
    }) as unknown as OrchestrationV2ThreadProjection;

  it("marks a queued message and skips one cancelled before it ran", () => {
    const exchange = lastExchange(
      projection(
        [
          { id: "run-1", status: "completed", userMessageId: "first", startedAt: "t", ordinal: 1 },
          { id: "run-2", status: "queued", userMessageId: "queued", startedAt: null, ordinal: 2 },
          {
            id: "run-3",
            status: "cancelled",
            userMessageId: "taken-back",
            startedAt: null,
            ordinal: 3,
          },
        ],
        [sent("first"), sent("queued"), sent("taken-back")],
      ),
    );
    expect(exchange.sent?.id).toBe("queued");
    // No running provider turn to steer into, so only cancelling is offered.
    expect(exchange.sent?.queued).toEqual({ runId: "run-2", steerTargetRunId: null });
  });

  it("leaves a message that already ran unqueued", () => {
    const exchange = lastExchange(
      projection(
        [{ id: "run-1", status: "completed", userMessageId: "first", startedAt: "t", ordinal: 1 }],
        [sent("first")],
      ),
    );
    expect(exchange.sent).toMatchObject({ id: "first", queued: null });
  });

  it("tells which model wrote the reply and when it finished", () => {
    const model = { instanceId: "claude", model: "claude-opus-5-5" };
    const exchange = lastExchange(
      projection(
        [
          {
            id: "run-1",
            status: "completed",
            userMessageId: "first",
            startedAt: "t",
            ordinal: 1,
            modelSelection: model,
          },
        ],
        [
          sent("first"),
          {
            id: "answer",
            role: "assistant",
            runId: "run-1",
            text: "done",
            streaming: false,
            updatedAt: DateTime.makeUnsafe("2026-10-21T17:00:00.000Z"),
          },
        ],
      ),
    );
    expect(exchange.reply).toMatchObject({ id: "answer", at: "2026-10-21T17:00:00.000Z", model });
  });
});
