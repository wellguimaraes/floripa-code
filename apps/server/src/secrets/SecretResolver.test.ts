// @effect-diagnostics nodeBuiltinImport:off -- the fake `op` reads the template the resolver wrote.
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { assert, describe, it } from "@effect/vitest";
import {
  SecretProviderId,
  SecretProviderKind,
  SettingsSecretUnresolvedError,
  type SecretReference,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";
import * as NodeFS from "node:fs";

import * as SecretResolver from "./SecretResolver.ts";

const encoder = new TextEncoder();
const account = "my.1password.com";
const personal = SecretProviderId.make("personal");

type OpResult = {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly hang?: boolean;
};

function fakeOp(answer: (args: ReadonlyArray<string>) => OpResult) {
  const invocations: Array<ReadonlyArray<string>> = [];
  const spawned = Deferred.makeUnsafe<void>();
  const layer = Layer.mergeAll(
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
          invocations.push(args);
          Deferred.doneUnsafe(spawned, Effect.void);
          const result = answer(args);
          return ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: result.hang
              ? Effect.never
              : Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            stdout: Stream.make(encoder.encode(result.stdout ?? "")),
            stderr: Stream.make(encoder.encode(result.stderr ?? "")),
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          });
        }),
      ),
    ),
    NodeFileSystem.layer,
    NodeCrypto.layer,
  );
  return { layer, invocations, spawned };
}

// Answers `op inject` by substituting each `{{ reference }}` in the template file it was handed.
const injectFrom =
  (secrets: Readonly<Record<string, string>>) =>
  (args: ReadonlyArray<string>): OpResult => {
    const template = NodeFS.readFileSync(args[args.indexOf("-i") + 1]!, "utf8");
    return { stdout: template.replace(/\{\{ (\S+) \}\}/g, (_, reference) => secrets[reference]!) };
  };

describe("1Password reads", () => {
  it.effect("reads one reference from the account", () => {
    const op = fakeOp(() => ({ stdout: "sk-live" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* SecretResolver.readOnePassword({ account } as never, [
          "op://Private/OpenAI/credential",
        ]),
        ["sk-live"],
      );
      assert.deepStrictEqual(op.invocations, [
        [
          "--cache=false",
          "read",
          "--account=my.1password.com",
          "--no-newline",
          "op://Private/OpenAI/credential",
        ],
      ]);
    }).pipe(Effect.provide(op.layer));
  });

  it.effect("reads a failed reference as undefined", () => {
    const op = fakeOp(() => ({ code: 1, stderr: "[ERROR] account is locked" }));
    return Effect.gen(function* () {
      assert.deepStrictEqual(
        yield* SecretResolver.readOnePassword({ account } as never, [
          "op://Private/OpenAI/credential",
        ]),
        [undefined],
      );
    }).pipe(Effect.provide(op.layer));
  });

  it.effect("reads every reference in a single call", () => {
    const op = fakeOp(
      injectFrom({
        "op://Private/OpenAI/credential": "sk-a",
        "op://Private/Anthropic/key": " sk-b\n",
      }),
    );
    return Effect.gen(function* () {
      const values = yield* SecretResolver.readOnePassword({ account } as never, [
        "op://Private/OpenAI/credential",
        "op://Private/Anthropic/key",
      ]);
      assert.deepStrictEqual(values, ["sk-a", " sk-b\n"]);
      assert.strictEqual(op.invocations.length, 1);
      assert.deepStrictEqual(op.invocations[0]?.slice(0, 3), [
        "--cache=false",
        "inject",
        "--account=my.1password.com",
      ]);
    }).pipe(Effect.provide(op.layer));
  });

  it.effect("falls back to one read at a time when the batch fails", () => {
    const op = fakeOp((args) =>
      args.includes("inject")
        ? { code: 1, stderr: '[ERROR] could not resolve "op://Private/Gone/key"' }
        : args.at(-1) === "op://Private/Gone/key"
          ? { code: 1, stderr: "[ERROR] item not found" }
          : { stdout: "sk-a" },
    );
    return Effect.gen(function* () {
      const values = yield* SecretResolver.readOnePassword({ account } as never, [
        "op://Private/OpenAI/credential",
        "op://Private/Gone/key",
      ]);
      assert.deepStrictEqual(values, ["sk-a", undefined]);
      assert.strictEqual(op.invocations.length, 3);
    }).pipe(Effect.provide(op.layer));
  });

  it.effect("does not read one at a time after the batch times out", () => {
    const op = fakeOp(() => ({ hang: true }));
    return Effect.gen(function* () {
      const reading = yield* SecretResolver.readOnePassword({ account } as never, [
        "op://Private/OpenAI/credential",
        "op://Private/Anthropic/key",
      ]).pipe(Effect.forkChild);
      yield* Deferred.await(op.spawned);
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(yield* Fiber.join(reading), [undefined, undefined]);
      assert.strictEqual(op.invocations.length, 1);
    }).pipe(Effect.provide(op.layer));
  });
});

const reference = (path: string): SecretReference => ({ provider: personal, reference: path });

const providers = (config: unknown = { account }): ServerSettings["secretProviders"] => ({
  [personal]: {
    kind: SecretProviderKind.make("one_password"),
    label: "Personal",
    config,
  },
});

const makeResolver = (options?: { readonly providers?: ServerSettings["secretProviders"] }) =>
  Effect.gen(function* () {
    const reads = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    const providersRef = yield* Ref.make(options?.providers ?? providers());
    const resolver = yield* SecretResolver.make({
      secretProviders: Ref.get(providersRef),
      readOnePassword: (_config, references) =>
        Ref.update(reads, (all) => [...all, references]).pipe(
          Effect.as(
            references.map((path) => (path.includes("Gone") ? undefined : `value:${path}`)),
          ),
        ),
    });
    return { resolver, reads, providersRef };
  });

describe("SecretResolver", () => {
  it.effect("reads once and serves later reads, including failures, from memory", () =>
    Effect.gen(function* () {
      const { resolver, reads } = yield* makeResolver();
      const gone = reference("op://Private/Gone/key");
      const ok = reference("op://Private/OpenAI/key");
      assert.deepStrictEqual(yield* resolver.read([ok, gone]), [
        "value:op://Private/OpenAI/key",
        undefined,
      ]);
      assert.deepStrictEqual(yield* resolver.read([gone, ok]), [
        undefined,
        "value:op://Private/OpenAI/key",
      ]);
      assert.strictEqual((yield* Ref.get(reads)).length, 1);
    }),
  );

  it.effect("reads again after invalidate", () =>
    Effect.gen(function* () {
      const { resolver, reads } = yield* makeResolver();
      const ok = reference("op://Private/OpenAI/key");
      yield* resolver.read([ok]);
      yield* resolver.invalidate([ok]);
      yield* resolver.read([ok]);
      yield* resolver.invalidate();
      yield* resolver.read([ok]);
      assert.strictEqual((yield* Ref.get(reads)).length, 3);
    }),
  );

  it.effect("reads again when the provider's account changes", () =>
    Effect.gen(function* () {
      const { resolver, reads, providersRef } = yield* makeResolver();
      const ok = reference("op://Private/OpenAI/key");
      yield* resolver.read([ok]);
      yield* Ref.set(providersRef, providers({ account: "other.1password.com" }));
      yield* resolver.read([ok]);
      assert.strictEqual((yield* Ref.get(reads)).length, 2);
    }),
  );

  it.effect("never reads an unknown provider, a bad reference, or an invalid config", () =>
    Effect.gen(function* () {
      const { resolver, reads, providersRef } = yield* makeResolver();
      assert.deepStrictEqual(
        yield* resolver.read([
          { provider: SecretProviderId.make("missing"), reference: "op://Private/A/b" },
          reference("op://Private/{{x}}/b"),
        ]),
        [undefined, undefined],
      );
      yield* Ref.set(providersRef, providers({ account: "--config=/tmp" }));
      assert.deepStrictEqual(yield* resolver.read([reference("op://Private/A/b")]), [undefined]);
      assert.deepStrictEqual(yield* Ref.get(reads), []);
    }),
  );

  it.effect("reads references of one provider together", () =>
    Effect.gen(function* () {
      const { resolver, reads } = yield* makeResolver();
      yield* resolver.read([reference("op://Private/A/b"), reference("op://Private/C/d")]);
      assert.deepStrictEqual(yield* Ref.get(reads), [["op://Private/A/b", "op://Private/C/d"]]);
    }),
  );

  it.effect("fails a required secret that cannot be read, naming the provider", () =>
    Effect.gen(function* () {
      const { resolver } = yield* makeResolver();
      assert.strictEqual(
        yield* SecretResolver.requireSettingsSecret(resolver, "plain-token"),
        "plain-token",
      );
      assert.strictEqual(
        yield* SecretResolver.requireSettingsSecret(resolver, reference("op://Private/A/b")),
        "value:op://Private/A/b",
      );
      const error = yield* SecretResolver.requireSettingsSecret(
        resolver,
        reference("op://Private/Gone/key"),
      ).pipe(Effect.flip);
      assert.instanceOf(error, SettingsSecretUnresolvedError);
      assert.strictEqual(error.provider, "Personal");
    }),
  );
});
