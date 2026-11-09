import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedString } from "./baseSchemas.ts";
import { SecretReference } from "./secretReference.ts";

/**
 * A credential setting: the literal, which is kept in the secret store and redacted for
 * clients, or the secret reference to read it from, which is not itself a secret and is
 * stored and shown as written.
 */
export const SettingsSecretValue = Schema.Union([TrimmedString, SecretReference]);
export type SettingsSecretValue = typeof SettingsSecretValue.Type;

export const isSecretReference = Schema.is(SecretReference);

/** The literal a credential setting holds, or `""` when it names a secret instead. */
export function settingsSecretLiteral(value: SettingsSecretValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export class SettingsSecretUnresolvedError extends Schema.TaggedError<SettingsSecretUnresolvedError>()(
  "SettingsSecretUnresolvedError",
  { provider: Schema.String },
) {
  override get message(): string {
    return `Could not read the credential from the secret provider "${this.provider}". Unlock or fix it in Settings, then try again.`;
  }
}

/**
 * The literal a credential setting holds once its secret is resolved. A reference still in
 * place could not be read, and fails instead of passing for a missing token, so callers that
 * would fall back to another credential cannot silently switch accounts.
 */
export const requireSettingsSecretLiteral = (
  value: SettingsSecretValue | undefined,
  secretProviders: Readonly<Record<string, { readonly label: string } | undefined>>,
): Effect.Effect<string, SettingsSecretUnresolvedError> =>
  isSecretReference(value)
    ? Effect.fail(
        new SettingsSecretUnresolvedError({
          provider:
            (Object.hasOwn(secretProviders, value.provider)
              ? secretProviders[value.provider]?.label.trim()
              : undefined) || value.provider,
        }),
      )
    : Effect.succeed(value ?? "");
