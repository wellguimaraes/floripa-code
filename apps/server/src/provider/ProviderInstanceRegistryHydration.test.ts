import { assert, it } from "@effect/vitest";
import {
  type ProviderInstanceConfigMap,
  ProviderDriverKind,
  ProviderInstanceId,
  SecretProviderId,
  type SecretReference,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type * as SecretResolver from "../secrets/SecretResolver.ts";
import { resolveProviderInstanceSecrets } from "./ProviderInstanceRegistryHydration.ts";

const personal = SecretProviderId.make("personal");
const readable: SecretReference = { provider: personal, reference: "op://P/OA/key" };
const unreadable: SecretReference = { provider: personal, reference: "op://P/Gone/key" };

const resolver: SecretResolver.SecretResolver["Service"] = {
  read: (references) =>
    Effect.succeed(
      references.map((reference) => (reference === unreadable ? undefined : "sk-from-vault")),
    ),
  invalidate: () => Effect.void,
  label: () => Effect.succeed("Personal"),
};

it.effect(
  "resolves readable references and leaves unreadable ones for the registry to refuse",
  () =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("codex_vault");
      const configMap: ProviderInstanceConfigMap = {
        [instanceId]: {
          driver: ProviderDriverKind.make("codex"),
          environment: [
            { name: "PLAIN", value: "kept", sensitive: false },
            { name: "OPENAI_API_KEY", value: readable, sensitive: true },
            { name: "MISSING", value: unreadable, sensitive: true },
          ],
        },
      };
      const resolved = yield* resolveProviderInstanceSecrets(resolver, configMap);
      assert.deepEqual(resolved[instanceId]?.environment, [
        { name: "PLAIN", value: "kept", sensitive: false },
        { name: "OPENAI_API_KEY", value: "sk-from-vault", sensitive: true },
        { name: "MISSING", value: unreadable, sensitive: true },
      ]);
      // The settings object itself is never rewritten with a secret.
      assert.deepEqual(configMap[instanceId]?.environment?.[1]?.value, readable);
    }),
);
