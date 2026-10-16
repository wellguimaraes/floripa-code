/**
 * FastBranchNamer - names a new worktree's branch through a fast OpenRouter
 * model, quick enough that the worktree can wait for it and get a readable
 * folder name. Without an OpenRouter key it makes no call, and callers keep
 * the temporary `t3/<hash>` name with the provider rename afterwards.
 *
 * @module textGeneration/FastBranchNamer
 */
import {
  type BranchNamingOptions,
  type ChatAttachment,
  TextGenerationError,
} from "@t3tools/contracts";
import { buildBranchNamePrompt } from "@t3tools/provider-core/server/textGenerationPrompts";
import { formatGeneratedBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";

const CHAT_COMPLETIONS_API = "https://openrouter.ai/api/v1/chat/completions";
const PRIMARY_MODEL = "z-ai/glm-5.3-flash:nitro";
const FALLBACK_MODEL = "deepseek/deepseek-v4.1-flash:nitro";
/**
 * The worktree waits on these calls, so each model gets a short budget: a slow
 * or failed primary hands over to the fallback, and a slow fallback loses to
 * the temporary name.
 */
const MODEL_TIMEOUT = "2500 millis";

const CompletionResponse = Schema.Struct({
  choices: Schema.NonEmptyArray(
    Schema.Struct({ message: Schema.Struct({ content: Schema.NullOr(Schema.String) }) }),
  ),
});
const decodeCompletion = Schema.decodeUnknownOption(CompletionResponse);
const decodeBranch = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ branch: Schema.String })),
);

const failed = (detail: string) =>
  new TextGenerationError({ operation: "generateBranchName", detail });

export interface FastBranchNameInput {
  readonly naming: BranchNamingOptions;
  readonly message: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
}

export class FastBranchNamer extends Context.Service<
  FastBranchNamer,
  {
    /** None without a call when no OpenRouter key is saved. */
    readonly generateBranchName: (
      input: FastBranchNameInput,
    ) => Effect.Effect<Option.Option<string>, TextGenerationError>;
  }
>()("t3/textGeneration/FastBranchNamer") {}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const client = yield* HttpClient.HttpClient;

  /** One model's raw branch answer, within its budget. */
  const ask = Effect.fn("FastBranchNamer.ask")(function* (
    apiKey: string,
    model: string,
    prompt: string,
  ) {
    const response = yield* client
      .execute(
        HttpClientRequest.post(CHAT_COMPLETIONS_API).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${apiKey}`),
          HttpClientRequest.bodyJsonUnsafe({
            model,
            messages: [{ role: "user", content: prompt }],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "branch_name",
                strict: true,
                schema: {
                  type: "object",
                  properties: { branch: { type: "string" } },
                  required: ["branch"],
                  additionalProperties: false,
                },
              },
            },
            // GLM flash cannot turn reasoning off; minimal effort answers in about a second.
            reasoning: { effort: "minimal", exclude: true },
            temperature: 0,
            max_tokens: 1000,
          }),
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.json.pipe(
            Effect.orElseSucceed((): unknown => null),
            Effect.map((body) => ({ status: response.status, body })),
          ),
        ),
        Effect.timeout(MODEL_TIMEOUT),
        Effect.mapError(() => failed(`Could not reach ${model} in time.`)),
      );
    if (response.status >= 400) {
      return yield* failed(`OpenRouter answered ${response.status} for ${model}.`);
    }
    const content = decodeCompletion(response.body).pipe(
      Option.flatMap((completion) => Option.fromNullishOr(completion.choices[0].message.content)),
      Option.flatMap((text) => decodeBranch(extractJsonObject(text))),
    );
    if (Option.isNone(content) || content.value.branch.trim() === "") {
      return yield* failed(`${model} sent no branch name.`);
    }
    return content.value.branch;
  });

  const generateBranchName = Effect.fn("FastBranchNamer.generateBranchName")(function* (
    input: FastBranchNameInput,
  ) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => failed("Could not read the settings.")),
    );
    const apiKey = ServerSettings.resolveOpenRouterApiKey(settings.voice);
    if (apiKey === "") return Option.none<string>();

    const { prompt } = buildBranchNamePrompt(input);
    const branch = yield* ask(apiKey, PRIMARY_MODEL, prompt).pipe(
      Effect.catch((error) =>
        Effect.logInfo("Fast branch naming fell back", { model: PRIMARY_MODEL, error }).pipe(
          Effect.andThen(ask(apiKey, FALLBACK_MODEL, prompt)),
        ),
      ),
    );
    return Option.some(formatGeneratedBranchName(branch, input.naming));
  });

  return FastBranchNamer.of({ generateBranchName });
});

export const layer = Layer.effect(FastBranchNamer, make);
