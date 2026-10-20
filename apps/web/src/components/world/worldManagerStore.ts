import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldManagerState {
  /** Whether islands show their manager. */
  readonly enabled: boolean;
  readonly setEnabled: (enabled: boolean) => void;
}

/** Off for now: hides every island's manager and the top bar toggle. Flip to bring them back. */
export const WORLD_MANAGERS_AVAILABLE = false;

/** The islands' managers, on or off. Per viewer, so it lives in this browser only. */
export const useWorldManagerStore = create<WorldManagerState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: "floripacode:world-managers:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ enabled: state.enabled }),
    },
  ),
);
