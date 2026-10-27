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

  it("skips a queued message and one cancelled before it ran", () => {
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
    expect(exchange.sent?.id).toBe("first");
  });

  it("pins a message that already ran", () => {
    const exchange = lastExchange(
      projection(
        [{ id: "run-1", status: "completed", userMessageId: "first", startedAt: "t", ordinal: 1 }],
        [sent("first")],
      ),
    );
    expect(exchange.sent?.id).toBe("first");
  });
});
