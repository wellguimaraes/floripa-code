import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldWeatherState {
  readonly raining: boolean;
  readonly setRaining: (raining: boolean) => void;
}

/** The world's weather. Per viewer, so it lives in this browser only. */
export const useWorldWeatherStore = create<WorldWeatherState>()(
  persist(
    (set) => ({
      raining: false,
      setRaining: (raining) => set({ raining }),
    }),
    {
      name: "t3code:world-weather:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ raining: state.raining }),
    },
  ),
);

/** Whether it rains in the world. */
export const selectRaining = (state: WorldWeatherState) => state.raining;

/** How long the rain takes to set in or clear up. */
const CHANGE_MS = 2000;
/** The amount moves in steps this often, so what depends on it re-renders only a few times. */
const STEP_MS = 100;

/**
 * How hard it rains, from 0 (clear) to 1 (full rain), easing between the two
 * over a couple of seconds whenever the weather changes. Starts settled.
 */
export function useRainAmount(): number {
  const raining = useWorldWeatherStore(selectRaining);
  const [amount, setAmount] = useState(raining ? 1 : 0);
  useEffect(() => {
    const target = raining ? 1 : 0;
    if (amount === target) return;
    const step = STEP_MS / CHANGE_MS;
    const timer = window.setTimeout(() => {
      setAmount(
        target > amount ? Math.min(target, amount + step) : Math.max(target, amount - step),
      );
    }, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [raining, amount]);
  return amount;
}
