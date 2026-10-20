import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldContrastState {
  /** 0 draws the world in full colour; 1 greys out everything but the characters. */
  readonly contrast: number;
  readonly setContrast: (contrast: number) => void;
}

/** How much the characters stand out from the world. Per viewer, so it lives in this browser only. */
export const useWorldContrastStore = create<WorldContrastState>()(
  persist(
    (set) => ({
      contrast: 0,
      setContrast: (contrast) => set({ contrast: Math.min(1, Math.max(0, contrast)) }),
    }),
    {
      name: "floripacode:world-contrast:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ contrast: state.contrast }),
    },
  ),
);
