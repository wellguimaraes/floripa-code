import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { fetchWeather, type Weather, WEATHER_POLL_MS } from "./worldWeather";

interface WorldWeatherState {
  /** Follows the real weather here (see `worldWeather`); off once the viewer picks the weather. */
  readonly auto: boolean;
  /** The picked weather, used while `auto` is off. */
  readonly raining: boolean;
  /** Lightning now and then; only ever with rain. */
  readonly storm: boolean;
  /** The last real weather read in auto mode; null until one arrives. */
  readonly live: Weather | null;
  readonly setRaining: (raining: boolean) => void;
  readonly setStorm: (storm: boolean) => void;
  readonly setAuto: (auto: boolean) => void;
  readonly setLive: (live: Weather | null) => void;
}

/** The world's weather. Per viewer, so it lives in this browser only. */
export const useWorldWeatherStore = create<WorldWeatherState>()(
  persist(
    (set, get) => ({
      auto: false,
      raining: false,
      storm: false,
      live: null,
      // Picking the weather leaves auto, starting from what was showing.
      setRaining: (raining) => set({ auto: false, raining, storm: raining && selectStorm(get()) }),
      setStorm: (storm) => set({ auto: false, storm, raining: storm || selectRaining(get()) }),
      setAuto: (auto) => set({ auto }),
      setLive: (live) => set({ live }),
    }),
    {
      name: "t3code:world-weather:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      // The last live reading too, so a reload shows it until the next one arrives.
      partialize: (state) => ({
        auto: state.auto,
        raining: state.raining,
        storm: state.storm,
        live: state.live,
      }),
    },
  ),
);

/** Whether it rains in the world: the real weather in auto mode, else the picked one. */
export const selectRaining = (state: WorldWeatherState) =>
  state.auto ? (state.live?.raining ?? false) : state.raining;
export const selectStorm = (state: WorldWeatherState) =>
  state.auto ? (state.live?.storm ?? false) : state.storm;

/** Reads the real weather now and every 15 minutes while auto mode is on. */
export function useLiveWeather() {
  const auto = useWorldWeatherStore((state) => state.auto);
  const setLive = useWorldWeatherStore((state) => state.setLive);
  useEffect(() => {
    if (!auto) return;
    const abort = new AbortController();
    // A failed read keeps the last weather; the next one tries again.
    const read = () =>
      void fetchWeather(abort.signal).then(
        (weather) => {
          if (weather !== null) setLive(weather);
        },
        () => {},
      );
    read();
    const timer = window.setInterval(read, WEATHER_POLL_MS);
    return () => {
      abort.abort();
      window.clearInterval(timer);
    };
  }, [auto, setLive]);
}

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
