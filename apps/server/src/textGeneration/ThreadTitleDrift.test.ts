import { afterEach, assert, beforeEach, describe, it, vi } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import type { ThreadTitleDriftInput as ProviderDriftInput } from "@t3tools/provider-core/server/textGeneration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ThreadTitleDrift from "./ThreadTitleDrift.ts";

const input = {
  cwd: "/repo",
  title: "Fix flaky login test",
  earlierMessages: ["The login test fails on CI about half the time"],
  latestMessage: "Now add dark mode to the settings page",
};

function makeLayer(options: {
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly noul?: number;
  readonly status?: number;
  readonly instances?: ReadonlyArray<ProviderInstance>;
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
          Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
            listInstances: Effect.succeed(options.instances ?? []),
          }),
        ),
      ),
    ),
  };
}

/** A provider account whose fast model answers drift checks with `title`. */
function driftInstance(driver: string, instanceId: string, title: string | null) {
  const calls: Array<ProviderDriftInput> = [];
  const instance = {
    instanceId: ProviderInstanceId.make(instanceId),
    driverKind: ProviderDriverKind.make(driver),
    enabled: true,
    textGeneration: {
      detectThreadTitleDrift: (request: ProviderDriftInput) =>
        Effect.sync(() => {
          calls.push(request);
          return { title };
        }),
    },
  } as unknown as ProviderInstance;
  return { instance, calls };
}

const check = ThreadTitleDrift.ThreadTitleDrift.use((drift) => drift.check(input));

describe("ThreadTitleDrift", () => {
  // The server falls back to this variable when no key is saved.
  beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", ""));
  afterEach(() => vi.unstubAllEnvs());

  it.effect("makes no call while retitling is off or no key is saved", () =>
    Effect.gen(function* () {
      for (const settings of [
        { voice: { openRouterApiKey: "sk-or-test" } },
        { autoRetitleThreads: true },
      ]) {
        const harness = makeLayer({ settings, noul: 1 });
        assert.deepEqual(yield* check.pipe(Effect.provide(harness.layer)), { type: "keep" });
        assert.equal(harness.requests.length, 0);
      }
    }),
  );

  it.effect("asks Jev and regenerates only when the thread clearly moved on", () =>
    Effect.gen(function* () {
      const settings = { autoRetitleThreads: true, voice: { openRouterApiKey: "sk-or-test" } };
      const moved = makeLayer({ settings, noul: 0.9 });
      assert.deepEqual(yield* check.pipe(Effect.provide(moved.layer)), { type: "regenerate" });
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
      assert.deepEqual(yield* check.pipe(Effect.provide(unsure.layer)), { type: "keep" });
    }),
  );

  it.effect("lets a subscription provider decide and title in one request", () =>
    Effect.gen(function* () {
      const other = driftInstance("claudeAgent", "claude_work", "Wrong account");
      const preferred = driftInstance("claudeAgent", "claudeAgent", "Settings Dark Mode");
      const harness = makeLayer({
        settings: { autoRetitleThreads: true, threadRetitleProvider: "claudeAgent" },
        instances: [other.instance, preferred.instance],
      });
      assert.deepEqual(yield* check.pipe(Effect.provide(harness.layer)), {
        type: "retitle",
        title: "Settings Dark Mode",
      });
      assert.equal(harness.requests.length, 0);
      assert.equal(other.calls.length, 0);
      assert.equal(preferred.calls[0]?.modelSelection.model, "claude-haiku-5-5");
      assert.equal(preferred.calls[0]?.latestMessage, input.latestMessage);

      const continued = driftInstance("cursor", "cursor", null);
      assert.deepEqual(
        yield* check.pipe(
          Effect.provide(
            makeLayer({
              settings: { autoRetitleThreads: true, threadRetitleProvider: "cursor" },
              instances: [continued.instance],
            }).layer,
          ),
        ),
        { type: "keep" },
      );
    }),
  );

  it.effect("keeps the title when the chosen provider has no account", () =>
    Effect.gen(function* () {
      const harness = makeLayer({
        settings: { autoRetitleThreads: true, threadRetitleProvider: "codex" },
        instances: [driftInstance("cursor", "cursor", "Unrelated").instance],
      });
      assert.deepEqual(yield* check.pipe(Effect.provide(harness.layer)), { type: "keep" });
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
