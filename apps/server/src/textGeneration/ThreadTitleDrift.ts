/**
 * ThreadTitleDrift - asks OpenRouter's Jev decision model whether a follow-up
 * message moved a thread to a different task than its title names. Jev answers
 * with a probability rather than text, so one cheap call per message is enough.
 *
 * @module textGeneration/ThreadTitleDrift
 */
import { TextGenerationError } from "@t3tools/contracts";
import { limitTitleMessage } from "@t3tools/provider-core/server/threadTitleContext";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";

const DECISIONS_API = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "~typesafe/jev-latest";
/** Retitling a thread that did not move is worse than keeping a stale title. */
const RETITLE_PROBABILITY = 0.7;
const EARLIER_MESSAGE_LIMIT = 8;
const EARLIER_MESSAGE_CHARS = 1_000;
const LATEST_MESSAGE_CHARS = 2_000;

const DecisionsResponse = Schema.Struct({
  answers: Schema.Struct({ moved_on: Schema.Struct({ noul: Schema.Number }) }),
});
const decodeDecisions = Schema.decodeUnknownOption(DecisionsResponse);

const failed = (detail: string) =>
  new TextGenerationError({ operation: "detectThreadTitleDrift", detail });

export interface ThreadTitleDriftInput {
  readonly title: string;
  /** The user's earlier messages, oldest first. */
  readonly earlierMessages: ReadonlyArray<string>;
  readonly latestMessage: string;
}

export class ThreadTitleDrift extends Context.Service<
  ThreadTitleDrift,
  {
    /** False without a call when retitling is off or no OpenRouter key is saved. */
    readonly shouldRetitle: (
      input: ThreadTitleDriftInput,
    ) => Effect.Effect<boolean, TextGenerationError>;
  }
>()("t3/textGeneration/ThreadTitleDrift") {}

/** The first message names the original task; the newest show where the thread went. */
export function driftState(input: ThreadTitleDriftInput) {
  const earlier =
    input.earlierMessages.length > EARLIER_MESSAGE_LIMIT + 1
      ? [input.earlierMessages[0]!, ...input.earlierMessages.slice(-EARLIER_MESSAGE_LIMIT)]
      : input.earlierMessages;
  return {
    thread_title: input.title,
    earlier_user_messages: earlier.map((text) => limitTitleMessage(text, EARLIER_MESSAGE_CHARS)),
    latest_user_message: limitTitleMessage(input.latestMessage, LATEST_MESSAGE_CHARS),
  };
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const client = yield* HttpClient.HttpClient;

  const shouldRetitle = Effect.fn("ThreadTitleDrift.shouldRetitle")(function* (
    input: ThreadTitleDriftInput,
  ) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => failed("Could not read the settings.")),
    );
    const apiKey = ServerSettings.resolveOpenRouterApiKey(settings.voice);
    if (!settings.autoRetitleThreads || apiKey === "") return false;

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
    if (response.status >= 400) {
      return yield* failed(`OpenRouter answered ${response.status}.`);
    }
    const decision = decodeDecisions(body);
    if (Option.isNone(decision)) return yield* failed("OpenRouter sent no decision.");
    return decision.value.answers.moved_on.noul >= RETITLE_PROBABILITY;
  });

  return ThreadTitleDrift.of({ shouldRetitle });
});

export const layer = Layer.effect(ThreadTitleDrift, make);
