/**
 * ThreadTitleDrift - decides whether a follow-up message moved a thread to a
 * different task than its title names. OpenRouter's Jev decision model answers
 * with a probability, so the caller still has to write the new title; a
 * subscription provider's fast model decides and writes the title in one request.
 *
 * @module textGeneration/ThreadTitleDrift
 */
import {
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_REASONING_EFFORT,
  type ModelSelection,
  type ProviderInstanceId,
  TextGenerationError,
  type ThreadRetitleProvider,
} from "@t3tools/contracts";
import { limitThreadTitleDriftMessages } from "@t3tools/provider-core/server/textGenerationPrompts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";

const DECISIONS_API = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "~typesafe/jev-latest";
/** Retitling a thread that did not move is worse than keeping a stale title. */
const RETITLE_PROBABILITY = 0.7;

const DecisionsResponse = Schema.Struct({
  answers: Schema.Struct({ moved_on: Schema.Struct({ noul: Schema.Number }) }),
});
const decodeDecisions = Schema.decodeUnknownOption(DecisionsResponse);

const failed = (detail: string) =>
  new TextGenerationError({ operation: "detectThreadTitleDrift", detail });

export interface ThreadTitleDriftInput {
  /** The checkout the thread works in. */
  readonly cwd: string;
  readonly title: string;
  /** The user's earlier messages, oldest first. */
  readonly earlierMessages: ReadonlyArray<string>;
  readonly latestMessage: string;
}

export type ThreadTitleDriftVerdict =
  | { readonly type: "keep" }
  /** The thread moved on, and the new title still has to be generated. */
  | { readonly type: "regenerate" }
  | { readonly type: "retitle"; readonly title: string };

const KEEP: ThreadTitleDriftVerdict = { type: "keep" };

export class ThreadTitleDrift extends Context.Service<
  ThreadTitleDrift,
  {
    /** Keeps the title without a call when retitling is off or its provider is unavailable. */
    readonly check: (
      input: ThreadTitleDriftInput,
    ) => Effect.Effect<ThreadTitleDriftVerdict, TextGenerationError>;
  }
>()("t3/textGeneration/ThreadTitleDrift") {}

/** The fast model each subscription provider decides with. */
export function driftModelSelection(
  provider: Exclude<ThreadRetitleProvider, "openrouter">,
  instanceId: ProviderInstanceId,
): ModelSelection {
  switch (provider) {
    case "claudeAgent":
      return { instanceId, model: "claude-haiku-5-5", options: [{ id: "effort", value: "low" }] };
    case "codex":
      return {
        instanceId,
        model: DEFAULT_TEXT_GENERATION_MODEL,
        options: [{ id: "reasoningEffort", value: DEFAULT_TEXT_GENERATION_REASONING_EFFORT }],
      };
    case "cursor":
      return { instanceId, model: "auto" };
  }
}

export function driftState(input: ThreadTitleDriftInput) {
  const messages = limitThreadTitleDriftMessages(input);
  return {
    thread_title: input.title,
    earlier_user_messages: messages.earlierMessages,
    latest_user_message: messages.latestMessage,
  };
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const client = yield* HttpClient.HttpClient;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;

  const askJev = Effect.fn("ThreadTitleDrift.askJev")(function* (
    apiKey: string,
    input: ThreadTitleDriftInput,
  ) {
    const response = yield* client
      .execute(
        HttpClientRequest.post(DECISIONS_API).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${apiKey}`),
          HttpClientRequest.bodyJsonUnsafe({
            model: JEV_MODEL,
            state: driftState(input),
            questions: {
              moved_on: {
                type: "noul",
                instructions:
                  "A coding agent thread is titled after the task the user asked for. Does the latest user message start a different task than the thread title names?",
                criteria: {
                  true: "The latest message asks for work on a different subject, feature, bug, or goal than the title describes.",
                  false:
                    "The latest message continues, refines, corrects, or follows up on the titled task, or is a short reply such as approval or a nudge to continue.",
                },
              },
            },
          }),
        ),
      )
      .pipe(
        Effect.timeout("15 seconds"),
        Effect.mapError(() => failed("Could not reach OpenRouter.")),
      );
    const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
    yield* settingsService.recordOpenRouterResponse(response.status);
    if (response.status >= 400) {
      return yield* failed(`OpenRouter answered ${response.status}.`);
    }
    const decision = decodeDecisions(body);
    if (Option.isNone(decision)) return yield* failed("OpenRouter sent no decision.");
    return decision.value.answers.moved_on.noul >= RETITLE_PROBABILITY
      ? ({ type: "regenerate" } as const)
      : KEEP;
  });

  const check = Effect.fn("ThreadTitleDrift.check")(function* (input: ThreadTitleDriftInput) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => failed("Could not read the settings.")),
    );
    if (!settings.autoRetitleThreads) return KEEP;
    const provider = settings.threadRetitleProvider ?? "openrouter";
    if (provider === "openrouter") {
      const apiKey = ServerSettings.resolveOpenRouterApiKey(settings.voice);
      return apiKey === "" ? KEEP : yield* askJev(apiKey, input);
    }
    // The provider's default instance first, then any other enabled account of it.
    const candidates = (yield* instances.listInstances).filter(
      (instance) => instance.driverKind === provider && instance.enabled,
    );
    const instance =
      candidates.find((candidate) => candidate.instanceId === provider) ?? candidates[0];
    if (instance === undefined) return KEEP;
    const { title } = yield* instance.textGeneration.detectThreadTitleDrift({
      ...input,
      modelSelection: driftModelSelection(provider, instance.instanceId),
    });
    return title === null ? KEEP : ({ type: "retitle", title } as const);
  });

  return ThreadTitleDrift.of({ check });
});

export const layer = Layer.effect(ThreadTitleDrift, make);
