/**
 * VoiceTranscriber — turns recorded speech into text through OpenRouter's
 * speech-to-text endpoint, with this environment's API key and chosen model.
 * The key never leaves the host, so remote clients use voice without holding it.
 *
 * @module voice/VoiceTranscriber
 */
import {
  VoiceTranscriptionError,
  type VoiceTranscribeInput,
  type VoiceTranscription,
  type VoiceTranscriptionModels,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import * as Settings from "../serverSettings.ts";

const OPENROUTER_API = "https://openrouter.ai/api/v1";

const TranscriptionResponse = Schema.Struct({ text: Schema.String });
const decodeTranscription = Schema.decodeUnknownOption(TranscriptionResponse);
const ErrorResponse = Schema.Struct({ error: Schema.Struct({ message: Schema.String }) });
const decodeErrorResponse = Schema.decodeUnknownOption(ErrorResponse);
const ModelsResponse = Schema.Struct({
  data: Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.optional(Schema.String) })),
});
const decodeModels = Schema.decodeUnknownOption(ModelsResponse);

const failed = (detail: string) => new VoiceTranscriptionError({ reason: "failed", detail });

export class VoiceTranscriber extends Context.Service<
  VoiceTranscriber,
  {
    readonly transcribe: (
      input: VoiceTranscribeInput,
    ) => Effect.Effect<VoiceTranscription, VoiceTranscriptionError>;
    /** OpenRouter's speech-to-text models. Public, so it works before a key is saved. */
    readonly listModels: Effect.Effect<VoiceTranscriptionModels, VoiceTranscriptionError>;
  }
>()("t3/voice/VoiceTranscriber") {}

const make = Effect.gen(function* () {
  const settingsService = yield* Settings.ServerSettingsService;
  const client = yield* HttpClient.HttpClient;

  const transcribe = Effect.fn("VoiceTranscriber.transcribe")(function* (
    input: VoiceTranscribeInput,
  ) {
    const { voice } = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => failed("Could not read the voice settings.")),
    );
    const apiKey = Settings.resolveOpenRouterApiKey(voice);
    if (apiKey === "") {
      return yield* new VoiceTranscriptionError({
        reason: "missingKey",
        detail: "Add an OpenRouter API key to use voice input.",
      });
    }
    const response = yield* client
      .execute(
        HttpClientRequest.post(`${OPENROUTER_API}/audio/transcriptions`).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${apiKey}`),
          HttpClientRequest.bodyJsonUnsafe({
            model: voice.transcriptionModel,
            input_audio: { data: input.audio, format: input.format },
          }),
        ),
      )
      .pipe(
        Effect.timeout("60 seconds"),
        Effect.mapError(() => failed("Could not reach OpenRouter.")),
      );
    const body = yield* response.json.pipe(Effect.orElseSucceed((): unknown => null));
    if (response.status === 401) {
      return yield* new VoiceTranscriptionError({
        reason: "rejectedKey",
        detail: "OpenRouter did not accept the API key.",
      });
    }
    if (response.status >= 400) {
      // OpenRouter's messages are short and say what to fix, such as an unknown model.
      const message = decodeErrorResponse(body).pipe(Option.map((error) => error.error.message));
      return yield* failed(
        Option.isSome(message)
          ? `OpenRouter: ${message.value}`
          : "OpenRouter could not transcribe.",
      );
    }
    const transcription = decodeTranscription(body);
    if (Option.isNone(transcription)) return yield* failed("OpenRouter sent no transcript.");
    return { text: transcription.value.text.trim() };
  });

  const listModels = client
    .execute(HttpClientRequest.get(`${OPENROUTER_API}/models?output_modalities=transcription`))
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap((response) => response.json),
      Effect.timeout("15 seconds"),
      Effect.mapError(() => failed("Could not load OpenRouter's models.")),
      Effect.flatMap((body) =>
        Option.match(decodeModels(body), {
          onNone: () => Effect.fail(failed("OpenRouter sent an unreadable model list.")),
          onSome: ({ data }) =>
            Effect.succeed({
              models: data
                .filter((model) => model.id.trim() !== "")
                .map((model) => ({ id: model.id, name: model.name ?? model.id })),
            }),
        }),
      ),
      Effect.withSpan("VoiceTranscriber.listModels"),
    );

  return { transcribe, listModels } satisfies VoiceTranscriber["Service"];
});

export const layer = Layer.effect(VoiceTranscriber, make);
