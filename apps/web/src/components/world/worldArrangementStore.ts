import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import type { IslandArrangement } from "./engine/archipelago";

interface WorldArrangementState {
  readonly arrangement: IslandArrangement;
  readonly setArrangement: (arrangement: IslandArrangement) => void;
}

/** How the world lines its islands up. Per viewer, so it lives in this browser only. */
export const useWorldArrangementStore = create<WorldArrangementState>()(
  persist(
    (set) => ({
      arrangement: "column",
      setArrangement: (arrangement) => set({ arrangement }),
    }),
    {
      name: "floripacode:world-arrangement:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ arrangement: state.arrangement }),
    },
  ),
);
