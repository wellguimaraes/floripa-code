import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { localHour } from "./scene/daylight";

interface WorldTimeState {
  /** Follows this browser's clock; off once the viewer picks an hour. */
  readonly auto: boolean;
  /** The picked hour, 0 to 24; used while `auto` is off. */
  readonly hour: number;
  readonly setHour: (hour: number) => void;
  readonly setAuto: (auto: boolean) => void;
}

/** The time of day the world shows. Per viewer, so it lives in this browser only. */
export const useWorldTimeStore = create<WorldTimeState>()(
  persist(
    (set) => ({
      auto: true,
      hour: 12,
      setHour: (hour) => set({ hour: Math.min(24, Math.max(0, hour)), auto: false }),
      setAuto: (auto) => set(auto ? { auto } : { auto, hour: localHour() }),
    }),
    {
      name: "floripacode:world-time:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ auto: state.auto, hour: state.hour }),
    },
  ),
);

/** How often the clock is read in auto mode; the light changes slowly. */
const CLOCK_MS = 60_000;

/** The hour the world shows: the picked one, or the clock's in auto mode. */
export function useWorldHour(): number {
  const auto = useWorldTimeStore((state) => state.auto);
  const picked = useWorldTimeStore((state) => state.hour);
  const [clock, setClock] = useState(localHour);
  useEffect(() => {
    if (!auto) return;
    const tick = () => setClock(localHour());
    // Catch up at once on switching back to auto, then once a minute.
    const now = window.setTimeout(tick);
    const timer = window.setInterval(tick, CLOCK_MS);
    return () => {
      window.clearTimeout(now);
      window.clearInterval(timer);
    };
  }, [auto]);
  return auto ? clock : picked;
}
