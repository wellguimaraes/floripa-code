import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { SecretProviderSlug } from "./secretReference.ts";

// Final once shipped: older builds drop entries whose key or kind fails here.
export const SecretProviderKind = SecretProviderSlug.pipe(Schema.brand("SecretProviderKind"));
export type SecretProviderKind = typeof SecretProviderKind.Type;

export const SecretProviderLabel = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

const ONE_PASSWORD_ACCOUNT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Any value `op --account` accepts: shorthand, sign-in address, account ID, or user ID.
 * It is passed to the CLI as an argument, so it can never start with `-`.
 */
export const OnePasswordAccount = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.makeFilter((value: string) =>
    ONE_PASSWORD_ACCOUNT_PATTERN.test(value)
      ? true
      : "1Password account must be a shorthand, sign-in address, or ID with no spaces.",
  ),
).pipe(Schema.brand("OnePasswordAccount"));
export type OnePasswordAccount = typeof OnePasswordAccount.Type;

export const OnePasswordSecretProviderConfig = Schema.Struct({
  account: OnePasswordAccount,
});
export type OnePasswordSecretProviderConfig = typeof OnePasswordSecretProviderConfig.Type;

// 1Password secret reference syntax: names outside this charset must be written as item ids.
// It also keeps `{{`, `}}`, and line breaks out of the `op inject` template the server builds.
const ONE_PASSWORD_NAME = String.raw`[A-Za-z0-9._-](?:[A-Za-z0-9 ._-]*[A-Za-z0-9._-])?`;
const ONE_PASSWORD_REFERENCE = new RegExp(
  String.raw`^op://${ONE_PASSWORD_NAME}(?:/${ONE_PASSWORD_NAME}){2,3}(?:\?[a-z-]+=[A-Za-z0-9_-]+)?$`,
);
const ONE_PASSWORD_MAX_REFERENCE_LENGTH = 1024;

export const ONE_PASSWORD_SECRET_PROVIDER_KIND = SecretProviderKind.make("one_password");

export const isOnePasswordReference = (reference: string) =>
  reference.length <= ONE_PASSWORD_MAX_REFERENCE_LENGTH && ONE_PASSWORD_REFERENCE.test(reference);

/** Kinds this build can resolve. Their `config` holds no credentials, so clients may read it. */
const SECRET_PROVIDER_KIND_CONFIG_GUARDS: Readonly<Record<string, (config: unknown) => boolean>> = {
  one_password: Schema.is(OnePasswordSecretProviderConfig),
};

export function isKnownSecretProviderKind(kind: string): boolean {
  return Object.hasOwn(SECRET_PROVIDER_KIND_CONFIG_GUARDS, kind);
}

export function isSecretProviderConfigValid(kind: string, config: unknown): boolean {
  return Object.hasOwn(SECRET_PROVIDER_KIND_CONFIG_GUARDS, kind)
    ? SECRET_PROVIDER_KIND_CONFIG_GUARDS[kind]!(config)
    : false;
}

/** Whether `reference` is syntax the provider's kind can read; unknown kinds read nothing. */
export function isSecretReferenceForKind(kind: string, reference: string): boolean {
  return kind === ONE_PASSWORD_SECRET_PROVIDER_KIND && isOnePasswordReference(reference);
}

/** Kinds decode their own config; unknown-kind envelopes round-trip verbatim across versions. */
export const SecretProviderConfig = Schema.Struct({
  kind: SecretProviderKind,
  label: TrimmedNonEmptyString,
  config: Schema.optionalKey(Schema.Unknown),
});
export type SecretProviderConfig = typeof SecretProviderConfig.Type;

// Limits that may change later are enforced on writes only, never on the stored envelope.
// Writes must be a kind this build knows with a config it accepts, so an older server
// rejects a newer kind instead of storing what it cannot check.
export const SecretProviderConfigWrite = Schema.Struct({
  ...SecretProviderConfig.fields,
  label: SecretProviderLabel,
}).check(
  Schema.makeFilter((entry) => {
    if (!isKnownSecretProviderKind(entry.kind)) {
      return `Unsupported secret provider kind: ${entry.kind}.`;
    }
    return isSecretProviderConfigValid(entry.kind, entry.config)
      ? true
      : `Invalid ${entry.kind} secret provider config.`;
  }),
);
