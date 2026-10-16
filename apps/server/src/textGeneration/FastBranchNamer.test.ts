import { assert, describe, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import * as FastBranchNamer from "./FastBranchNamer.ts";

const input = {
  naming: { mode: "static" as const, prefix: "t3", instructions: "" },
  message: "The login page redirects to a 404 after signing in",
  attachments: [],
};

const PRIMARY = "z-ai/glm-5.3-flash:nitro";
const FALLBACK = "deepseek/deepseek-v4.1-flash:nitro";

/** How one model answers: a reply, or never (to test the budget). */
type Answer = { readonly content: string | null; readonly status?: number } | "never";

function makeLayer(options: {
  readonly settings: Parameters<typeof ServerSettings.layerTest>[0];
  readonly answers?: Partial<Record<string, Answer>>;
}) {
  const requests: Array<{
    url: string;
    authorization: string | undefined;
    body: { readonly model: string };
  }> = [];
  const client = HttpClient.make((request) =>
    Effect.gen(function* () {
      const body: { readonly model: string } =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : { model: "" };
      requests.push({ url: request.url, authorization: request.headers["authorization"], body });
      const answer = options.answers?.[body.model] ?? { content: null };
      if (answer === "never") return yield* Effect.never;
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          { choices: [{ message: { content: answer.content } }] },
          { status: answer.status ?? 200 },
        ),
      );
    }),
  );
  return {
    requests,
    layer: FastBranchNamer.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(HttpClient.HttpClient, client),
          ServerSettings.layerTest(options.settings),
        ),
      ),
    ),
  };
}

const generate = FastBranchNamer.FastBranchNamer.use((namer) => namer.generateBranchName(input));
const settings = { voice: { openRouterApiKey: "sk-or-test" } };

describe("FastBranchNamer", () => {
  it.effect("makes no call without an OpenRouter key", () =>
    Effect.gen(function* () {
      // The server's own OPENROUTER_API_KEY counts as a saved key.
      vi.stubEnv("OPENROUTER_API_KEY", "");
      const harness = makeLayer({
        settings: {},
        answers: { [PRIMARY]: { content: '{"branch":"fix-login"}' } },
      });
      assert.isTrue(Option.isNone(yield* generate.pipe(Effect.provide(harness.layer))));
      assert.equal(harness.requests.length, 0);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs()))),
  );

  it.effect("asks the primary model and applies the naming prefix", () =>
    Effect.gen(function* () {
      const harness = makeLayer({
        settings,
        answers: { [PRIMARY]: { content: '{"branch":"Fix Login Redirect"}' } },
      });
      const named = yield* generate.pipe(Effect.provide(harness.layer));
      assert.deepEqual(named, Option.some("t3/fix-login-redirect"));
      assert.equal(harness.requests.length, 1);
      const request = harness.requests[0]!;
      assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(request.authorization, "Bearer sk-or-test");
      assert.equal(request.body.model, PRIMARY);
    }),
  );

  it.effect("falls back when the primary model errors", () =>
    Effect.gen(function* () {
      const harness = makeLayer({
        settings,
        answers: {
          [PRIMARY]: { content: null, status: 503 },
          [FALLBACK]: { content: '{"branch":"fix-login"}' },
        },
      });
      const named = yield* generate.pipe(Effect.provide(harness.layer));
      assert.deepEqual(named, Option.some("t3/fix-login"));
      assert.deepEqual(
        harness.requests.map((request) => request.body.model),
        [PRIMARY, FALLBACK],
      );
    }),
  );

  it.effect("falls back when the primary model is slow, and gives up when both are", () =>
    Effect.gen(function* () {
      const slowPrimary = makeLayer({
        settings,
        answers: { [PRIMARY]: "never", [FALLBACK]: { content: '{"branch":"fix-login"}' } },
      });
      const fiber = yield* generate.pipe(Effect.provide(slowPrimary.layer), Effect.forkChild);
      yield* TestClock.adjust("2500 millis");
      assert.deepEqual(yield* Fiber.join(fiber), Option.some("t3/fix-login"));

      const bothSlow = makeLayer({
        settings,
        answers: { [PRIMARY]: "never", [FALLBACK]: "never" },
      });
      const stuck = yield* generate.pipe(
        Effect.provide(bothSlow.layer),
        Effect.flip,
        Effect.forkChild,
      );
      yield* TestClock.adjust("5 seconds");
      assert.equal((yield* Fiber.join(stuck)).operation, "generateBranchName");
      assert.equal(bothSlow.requests.length, 2);
    }),
  );

  it.effect("fails when no model sends a name", () =>
    Effect.gen(function* () {
      const harness = makeLayer({ settings });
      const error = yield* generate.pipe(Effect.provide(harness.layer), Effect.flip);
      assert.equal(error.operation, "generateBranchName");
      assert.equal(harness.requests.length, 2);
    }),
  );
});
