import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldModeState {
  readonly enabled: boolean;
  readonly setEnabled: (enabled: boolean) => void;
  readonly toggle: () => void;
}

/** Whether the chat layout shows the world. Per viewer, so it lives in this browser only. */
export const useWorldModeStore = create<WorldModeState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (enabled) => set({ enabled }),
      toggle: () => set((state) => ({ enabled: !state.enabled })),
    }),
    {
      name: "t3code:world-mode:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ enabled: state.enabled }),
    },
  ),
);
