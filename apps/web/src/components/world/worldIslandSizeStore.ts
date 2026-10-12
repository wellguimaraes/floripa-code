import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldIslandSizeState {
  /** Size step per island, by its project group's key; none means the smallest. */
  readonly sizes: Readonly<Record<string, number>>;
  readonly setSize: (key: string, size: number) => void;
}

/** How big each island is drawn. Per viewer, so it lives in this browser only. */
export const useWorldIslandSizeStore = create<WorldIslandSizeState>()(
  persist(
    (set) => ({
      sizes: {},
      setSize: (key, size) =>
        set((state) => {
          const { [key]: _previous, ...rest } = state.sizes;
          return { sizes: size === 0 ? rest : { ...rest, [key]: size } };
        }),
    }),
    {
      name: "t3code:world-island-size:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ sizes: state.sizes }),
    },
  ),
);
