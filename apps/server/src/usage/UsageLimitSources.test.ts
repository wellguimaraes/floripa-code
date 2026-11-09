import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  SecretProviderId,
  UsageLimitSourceId,
  type ServerSettings,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as SecretResolver from "../secrets/SecretResolver.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as UsageLimitSources from "./UsageLimitSources.ts";

const sourceId = UsageLimitSourceId.make("hub");
const keyReference = { provider: SecretProviderId.make("personal"), reference: "op://P/Hub/key" };

/** One hub whose key is `managementKey`; `secret` is what the secret provider answers. */
const readHub = (managementKey: SettingsSecretValue, secret: string | undefined) => {
  const authorizations: Array<string | undefined> = [];
  const settings: ServerSettings = {
    ...DEFAULT_SERVER_SETTINGS,
    usageLimitSources: {
      [sourceId]: { kind: "cliproxy", url: "http://hub.test:8317", managementKey, enabled: true },
    },
  };
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      authorizations.push(request.headers.authorization);
      return HttpClientResponse.fromWeb(request, Response.json({ files: [] }));
    }),
  );
  return Effect.gen(function* () {
    const sources = yield* UsageLimitSources.make;
    yield* sources.refresh;
    return { snapshots: yield* sources.current, authorizations };
  }).pipe(
    Effect.scoped,
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provide(NodeCrypto.layer),
    Effect.provideService(
      ServerSettingsModule.ServerSettingsService,
      ServerSettingsModule.ServerSettingsService.of({
        getSettings: Effect.succeed(settings),
        streamChanges: Stream.empty,
      } as never),
    ),
    Effect.provideService(
      BackgroundPolicy.BackgroundPolicy,
      BackgroundPolicy.BackgroundPolicy.of({
        shouldRunScopeWork: () => Effect.succeed(false),
      } as never),
    ),
    Effect.provideService(
      SecretResolver.SecretResolver,
      SecretResolver.SecretResolver.of({
        read: (references) => Effect.succeed(references.map(() => secret)),
        invalidate: () => Effect.void,
        label: () => Effect.succeed("Personal"),
      }),
    ),
  );
};

describe("UsageLimitSources", () => {
  it.effect("reads the hub with the key its secret provider holds", () =>
    Effect.gen(function* () {
      const { snapshots, authorizations } = yield* readHub(keyReference, "key-from-vault");
      assert.deepStrictEqual(authorizations, ["Bearer key-from-vault"]);
      assert.isUndefined(snapshots[0]?.error);
    }),
  );

  it.effect("reports an unreadable key instead of calling the hub", () =>
    Effect.gen(function* () {
      const { snapshots, authorizations } = yield* readHub(keyReference, undefined);
      assert.deepStrictEqual(authorizations, []);
      assert.include(snapshots[0]?.error ?? "", "Personal");
      assert.notInclude(snapshots[0]?.error ?? "", "op://");
    }),
  );
});
