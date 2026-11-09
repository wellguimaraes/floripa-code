import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";
import { useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";

import { environmentServerConfigsAtom } from "../state/server";
import { useNowMinute } from "./useNowMinute";

/**
 * A new thread's starting model: the default, or the environment's fallback model while the
 * default's provider is out of usage. `fallback` is set only when the swap happened.
 */
export function useNewThreadModelFallback(
  environmentId: EnvironmentId | null,
  defaultSelection: ModelSelection | null,
) {
  const configs = useAtomValue(environmentServerConfigsAtom);
  const config = environmentId ? configs.get(environmentId) : undefined;
  const nowMinute = useNowMinute();
  return useMemo(
    () =>
      resolveNewThreadModelSelection({
        defaultSelection,
        fallbackSelection: config?.settings.fallbackModelSelection ?? null,
        providers: config?.providers ?? [],
        ...(config ? { settings: config.settings } : {}),
        now: Date.parse(`${nowMinute}:00Z`),
      }),
    [config, defaultSelection, nowMinute],
  );
}
