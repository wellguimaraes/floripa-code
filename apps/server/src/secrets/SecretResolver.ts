/**
 * SecretResolver reads secrets that settings point at through a configured secret provider.
 * Each read, including a failed one, is held for the server's life so rebuilds never re-prompt
 * an unlock; `invalidate` (the Settings refresh) is the only way to read again.
 *
 * Today the only kind is 1Password, read through the `op` CLI.
 *
 * @module secrets/SecretResolver
 */
import {
  isSecretReferenceForKind,
  isSecretProviderConfigValid,
  isSecretReference,
  SettingsSecretUnresolvedError,
  type OnePasswordSecretProviderConfig,
  type SecretReference,
  type ServerSettings,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";
import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import { ChildProcess } from "effect/process";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as Settings from "../serverSettings.ts";

export class SecretResolver extends Context.Service<
  SecretResolver,
  {
    /** Values in input order; `undefined` marks a reference that could not be read. */
    readonly read: (
      references: ReadonlyArray<SecretReference>,
    ) => Effect.Effect<ReadonlyArray<string | undefined>>;
    /** Forgets the given references, or every reference, so the next read asks the provider again. */
    readonly invalidate: (references?: ReadonlyArray<SecretReference>) => Effect.Effect<void>;
    /** The name the user gave a secret provider, or its id when it has none or is gone. */
    readonly label: (provider: SecretReference["provider"]) => Effect.Effect<string>;
  }
>()("t3/secrets/SecretResolver") {}

const ONE_PASSWORD_BINARY = "op";
// Bounds a read long enough to reach for a fingerprint reader, short enough not to wedge a rebuild.
const READ_TIMEOUT = Duration.seconds(45);

// `--cache=false` skips the `op daemon`, which hangs on prompts a background server cannot show.
const runOnePassword = Effect.fn("SecretResolver.runOnePassword")(function* (
  args: ReadonlyArray<string>,
) {
  const spawnCommand = yield* resolveSpawnCommand(ONE_PASSWORD_BINARY, ["--cache=false", ...args]);
  return yield* spawnAndCollect(
    ONE_PASSWORD_BINARY,
    ChildProcess.make(spawnCommand.command, spawnCommand.args, { shell: spawnCommand.shell }),
  );
});

// A secret is passed on verbatim; surrounding whitespace can be part of it.
const nonEmpty = (value: string) => (value.trim().length > 0 ? value : undefined);

const readOne = Effect.fn("SecretResolver.readOne")(function* (account: string, reference: string) {
  const result = yield* runOnePassword(["read", `--account=${account}`, "--no-newline", reference]);
  if (result.code !== 0) {
    yield* Effect.logWarning("Could not read secret from 1Password", {
      stage: "read",
      exitCode: result.code,
    });
    return undefined;
  }
  return nonEmpty(result.stdout);
});

// One `op inject` costs one unlock for every reference in the template. `op` ignores piped stdin
// from Node, so the template goes through a temp file. A random separator after every reference
// keeps one secret from shifting the others, and leaves any trailing newline outside the values.
const readTogether = Effect.fn("SecretResolver.readTogether")(function* (
  account: string,
  references: ReadonlyArray<string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const separator = `__t3-secret-${yield* crypto.randomUUIDv4}__`;
  const templatePath = yield* fileSystem.makeTempFileScoped({ prefix: "t3code-op-inject-" });
  yield* fileSystem.writeFileString(
    templatePath,
    references.map((reference) => `{{ ${reference} }}${separator}`).join(""),
  );
  const result = yield* runOnePassword(["inject", `--account=${account}`, "-i", templatePath]);
  const values = result.stdout.split(separator);
  const trailing = values.pop();
  if (
    result.code !== 0 ||
    values.length !== references.length ||
    trailing === undefined ||
    trailing.trim().length > 0
  ) {
    yield* Effect.logWarning("Could not batch-read secrets from 1Password", {
      stage: "inject",
      exitCode: result.code,
      references: references.length,
    });
    return undefined;
  }
  return values.map(nonEmpty);
}, Effect.scoped);

/** `None` when 1Password did not answer in time; a failed run reads as `Some(undefined)`. */
const bounded = <A, E, R>(stage: "read" | "inject", effect: Effect.Effect<A | undefined, E, R>) =>
  effect.pipe(
    Effect.timeoutOption(READ_TIMEOUT),
    Effect.tap((outcome) =>
      Option.isNone(outcome)
        ? Effect.logWarning("1Password did not answer in time", { stage })
        : Effect.void,
    ),
    Effect.catchCause(() =>
      Effect.logWarning("Could not run 1Password", { stage }).pipe(
        Effect.as(Option.some(undefined)),
      ),
    ),
  );

/** Values in input order; `undefined` marks a reference 1Password could not read. */
export const readOnePassword = Effect.fn("SecretResolver.readOnePassword")(function* (
  { account }: OnePasswordSecretProviderConfig,
  references: ReadonlyArray<string>,
) {
  if (references.length > 1) {
    const together = yield* bounded("inject", readTogether(account, references));
    // Reading one by one after a timeout would only wait that long again for each reference.
    if (Option.isNone(together)) return references.map(() => undefined);
    if (together.value !== undefined) return together.value;
  }
  return yield* Effect.forEach(references, (reference) =>
    bounded("read", readOne(account, reference)).pipe(Effect.map(Option.getOrUndefined)),
  );
});

const cacheKey = (reference: SecretReference) =>
  `${reference.provider}\u0000${reference.reference}`;

interface CachedSecret {
  // A provider whose config changed, such as another account, reads again.
  readonly config: string;
  readonly value: string | undefined;
}

interface ReadablePlan {
  readonly config: OnePasswordSecretProviderConfig;
  readonly configKey: string;
}

export const make = Effect.fn("SecretResolver.make")(function* (options: {
  readonly secretProviders: Effect.Effect<ServerSettings["secretProviders"]>;
  readonly readOnePassword: (
    config: OnePasswordSecretProviderConfig,
    references: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<string | undefined>>;
}) {
  const readFromOnePassword = options.readOnePassword;
  const cache = new Map<string, CachedSecret>();
  const semaphore = yield* Semaphore.make(1);

  // Only a provider this build can read is cached; anything else fails fast and is checked again
  // on the next read.
  const planFor = (
    providers: ServerSettings["secretProviders"],
    reference: SecretReference,
  ): ReadablePlan | undefined => {
    const provider = Object.hasOwn(providers, reference.provider)
      ? providers[reference.provider]
      : undefined;
    if (provider === undefined) return undefined;
    if (!isSecretReferenceForKind(provider.kind, reference.reference)) return undefined;
    if (!isSecretProviderConfigValid(provider.kind, provider.config)) return undefined;
    const config = provider.config as OnePasswordSecretProviderConfig;
    return { config, configKey: JSON.stringify(config) };
  };

  const isCached = (reference: SecretReference, plan: ReadablePlan) =>
    cache.get(cacheKey(reference))?.config === plan.configKey;

  const answer = (
    references: ReadonlyArray<SecretReference>,
    plans: ReadonlyArray<ReadablePlan | undefined>,
  ) =>
    references.map((reference, index) => {
      const plan = plans[index];
      return plan !== undefined && isCached(reference, plan)
        ? cache.get(cacheKey(reference))?.value
        : undefined;
    });

  // Cache hits answer without the lock, so a read waiting on an unlock never stalls a cached one.
  const read: SecretResolver["Service"]["read"] = Effect.fn("SecretResolver.read")(
    function* (references) {
      const providers = yield* options.secretProviders;
      const plans = references.map((reference) => planFor(providers, reference));
      const isMissing = (reference: SecretReference, index: number) => {
        const plan = plans[index];
        return plan !== undefined && !isCached(reference, plan);
      };
      if (!references.some(isMissing)) return answer(references, plans);

      return yield* semaphore.withPermits(1)(
        Effect.gen(function* () {
          const wanted = new Map<
            string,
            {
              readonly plan: ReadablePlan;
              readonly byReference: Map<string, Array<SecretReference>>;
            }
          >();
          references.forEach((reference, index) => {
            const plan = plans[index];
            if (plan === undefined || !isMissing(reference, index)) return;
            const group = wanted.get(reference.provider) ?? { plan, byReference: new Map() };
            group.byReference.set(reference.reference, [
              ...(group.byReference.get(reference.reference) ?? []),
              reference,
            ]);
            wanted.set(reference.provider, group);
          });
          for (const { plan, byReference } of wanted.values()) {
            const values = yield* readFromOnePassword(plan.config, [...byReference.keys()]);
            [...byReference.values()].forEach((sameReference, index) => {
              for (const reference of sameReference) {
                cache.set(cacheKey(reference), { config: plan.configKey, value: values[index] });
              }
            });
          }
          return answer(references, plans);
        }),
      );
    },
  );

  const invalidate: SecretResolver["Service"]["invalidate"] = (references) =>
    semaphore.withPermits(1)(
      Effect.sync(() => {
        if (references === undefined) cache.clear();
        else for (const reference of references) cache.delete(cacheKey(reference));
      }),
    );

  const label: SecretResolver["Service"]["label"] = (provider) =>
    options.secretProviders.pipe(
      Effect.map(
        (providers) =>
          (Object.hasOwn(providers, provider) ? providers[provider]?.label.trim() : undefined) ||
          provider,
      ),
    );

  return SecretResolver.of({ read, invalidate, label });
});

export const layer = Layer.effect(
  SecretResolver,
  Effect.gen(function* () {
    const settings = yield* Settings.ServerSettingsService;
    // The services only 1Password reads need are optional, so layers that never read a
    // secret, such as CLI tools, build without them; a read then finds nothing.
    const spawner = yield* Effect.serviceOption(ChildProcessSpawner.ChildProcessSpawner);
    const fileSystem = yield* Effect.serviceOption(FileSystem.FileSystem);
    const crypto = yield* Effect.serviceOption(Crypto.Crypto);
    return yield* make({
      secretProviders: settings.getSettings.pipe(
        Effect.map((value) => value.secretProviders),
        Effect.orElseSucceed(() => ({})),
      ),
      readOnePassword: (config, references) =>
        Option.isSome(spawner) && Option.isSome(fileSystem) && Option.isSome(crypto)
          ? readOnePassword(config, references).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner.value),
              Effect.provideService(FileSystem.FileSystem, fileSystem.value),
              Effect.provideService(Crypto.Crypto, crypto.value),
            )
          : Effect.succeed(references.map(() => undefined)),
    });
  }),
);

/**
 * The secret a credential setting holds or names. A named secret that cannot be read, or reads
 * empty, fails instead of passing for a missing token, so callers that would fall back to another
 * credential cannot silently switch accounts.
 */
export const requireSettingsSecret = Effect.fn("SecretResolver.requireSettingsSecret")(function* (
  resolver: SecretResolver["Service"],
  value: SettingsSecretValue,
) {
  if (!isSecretReference(value)) return value;
  const [secret] = yield* resolver.read([value]);
  if (secret === undefined || secret.trim() === "") {
    return yield* new SettingsSecretUnresolvedError({
      provider: yield* resolver.label(value.provider),
    });
  }
  return secret;
});

/**
 * `settings` with each GitHub host token that names a secret replaced by the secret, read in one
 * batch. A secret that cannot be read, or reads empty, keeps its reference.
 */
export const resolveGitHubTokens = Effect.fn("SecretResolver.resolveGitHubTokens")(function* (
  resolver: SecretResolver["Service"],
  settings: ServerSettings,
) {
  const pending = Object.entries(settings.github.tokens).flatMap(([host, token]) =>
    isSecretReference(token) ? [{ host, reference: token }] : [],
  );
  if (pending.length === 0) return settings;
  const values = yield* resolver.read(pending.map(({ reference }) => reference));
  const tokens: Record<string, SettingsSecretValue> = { ...settings.github.tokens };
  pending.forEach(({ host }, index) => {
    const value = values[index];
    if (value !== undefined && value.trim() !== "") tokens[host] = value;
  });
  return { ...settings, github: { ...settings.github, tokens } };
});
