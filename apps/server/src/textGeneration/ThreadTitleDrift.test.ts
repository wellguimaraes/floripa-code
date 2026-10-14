import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import * as ThreadTitleDrift from "./ThreadTitleDrift.ts";

const input = {
  title: "Fix flaky login test",
  earlierMessages: ["The login test fails on CI about half the time"],
  latestMessage: "Now add dark mode to the settings page",
};

function makeLayer(options: {
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly noul?: number;
  readonly status?: number;
}) {
  const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({
        url: request.url,
        authorization: request.headers["authorization"],
        body:
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : null,
      });
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          { answers: { moved_on: { type: "noul", noul: options.noul ?? 0 } } },
          { status: options.status ?? 200 },
        ),
      );
    }),
  );
  return {
    requests,
    layer: ThreadTitleDrift.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HttpClient.HttpClient, client),
          ServerSettings.layerTest(options.settings),
        ),
      ),
    ),
  };
}

describe("ThreadTitleDrift", () => {
  it.effect("makes no call while retitling is off or no key is saved", () =>
    Effect.gen(function* () {
      for (const settings of [
        { voice: { openRouterApiKey: "sk-or-test" } },
        { autoRetitleThreads: true },
      ]) {
        const harness = makeLayer({ settings, noul: 1 });
        const retitle = yield* ThreadTitleDrift.ThreadTitleDrift.use((drift) =>
          drift.shouldRetitle(input),
        ).pipe(Effect.provide(harness.layer));
        assert.isFalse(retitle);
        assert.equal(harness.requests.length, 0);
      }
    }),
  );

  it.effect("asks Jev and retitles only when the thread clearly moved on", () =>
    Effect.gen(function* () {
      const settings = { autoRetitleThreads: true, voice: { openRouterApiKey: "sk-or-test" } };
      const moved = makeLayer({ settings, noul: 0.9 });
      assert.isTrue(
        yield* ThreadTitleDrift.ThreadTitleDrift.use((drift) => drift.shouldRetitle(input)).pipe(
          Effect.provide(moved.layer),
        ),
      );
      const request = moved.requests[0]!;
      assert.equal(request.url, "https://openrouter.ai/api/alpha/decisions");
      assert.equal(request.authorization, "Bearer sk-or-test");
      assert.deepInclude(request.body as object, {
        state: {
          thread_title: input.title,
          earlier_user_messages: input.earlierMessages,
          latest_user_message: input.latestMessage,
        },
      });

      const unsure = makeLayer({ settings, noul: 0.5 });
      assert.isFalse(
        yield* ThreadTitleDrift.ThreadTitleDrift.use((drift) => drift.shouldRetitle(input)).pipe(
          Effect.provide(unsure.layer),
        ),
      );
    }),
  );

  it("keeps the first message and the newest ones when the thread is long", () => {
    const state = ThreadTitleDrift.driftState({
      ...input,
      earlierMessages: Array.from({ length: 20 }, (_, index) => `message ${index}`),
    });
    assert.deepEqual(state.earlier_user_messages, [
      "message 0",
      ...Array.from({ length: 8 }, (_, index) => `message ${index + 12}`),
    ]);
  });
});
