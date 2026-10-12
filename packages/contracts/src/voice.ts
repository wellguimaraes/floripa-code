import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Containers a browser's recorder produces; OpenRouter takes each one by name. */
export const VoiceAudioFormat = Schema.Literals(["webm", "ogg", "m4a", "wav", "mp3"]);
export type VoiceAudioFormat = typeof VoiceAudioFormat.Type;

/** About four minutes of Opus speech once base64-encoded; recorders stop well before it. */
export const VOICE_AUDIO_MAX_BASE64_LENGTH = 4_000_000;

export const VoiceTranscribeInput = Schema.Struct({
  /** Base64 audio bytes, without a data-URL prefix. */
  audio: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(VOICE_AUDIO_MAX_BASE64_LENGTH),
  ),
  format: VoiceAudioFormat,
});
export type VoiceTranscribeInput = typeof VoiceTranscribeInput.Type;

export const VoiceTranscription = Schema.Struct({ text: Schema.String });
export type VoiceTranscription = typeof VoiceTranscription.Type;

export const VoiceTranscriptionModel = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
});
export type VoiceTranscriptionModel = typeof VoiceTranscriptionModel.Type;

export const VoiceTranscriptionModels = Schema.Struct({
  models: Schema.Array(VoiceTranscriptionModel),
});
export type VoiceTranscriptionModels = typeof VoiceTranscriptionModels.Type;

/**
 * `missingKey` and `rejectedKey` mean the environment needs an OpenRouter API
 * key before voice input works, so a client can ask for one.
 */
export class VoiceTranscriptionError extends Schema.TaggedError<VoiceTranscriptionError>()(
  "VoiceTranscriptionError",
  {
    reason: Schema.Literals(["missingKey", "rejectedKey", "failed"]),
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
