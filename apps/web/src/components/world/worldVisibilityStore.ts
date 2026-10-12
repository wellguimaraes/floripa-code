import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldVisibilityState {
  /** Islands taken off the map, by their project group's key. */
  readonly hidden: Readonly<Record<string, true>>;
  /** Whether the projects menu is expanded. */
  readonly menuOpen: boolean;
  readonly toggleHidden: (key: string) => void;
  /** Hides every island in `all` but `key`. */
  readonly showOnly: (key: string, all: ReadonlyArray<string>) => void;
  readonly setMenuOpen: (open: boolean) => void;
}

/** Which projects the world shows. Per viewer, so it lives in this browser only. */
export const useWorldVisibilityStore = create<WorldVisibilityState>()(
  persist(
    (set) => ({
      hidden: {},
      menuOpen: false,
      toggleHidden: (key) =>
        set((state) => {
          const { [key]: wasHidden, ...rest } = state.hidden;
          return { hidden: wasHidden ? rest : { ...rest, [key]: true } };
        }),
      showOnly: (key, all) =>
        set({
          hidden: Object.fromEntries(
            all.filter((other) => other !== key).map((other) => [other, true as const]),
          ),
        }),
      setMenuOpen: (menuOpen) => set({ menuOpen }),
    }),
    {
      name: "t3code:world-visibility:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ hidden: state.hidden, menuOpen: state.menuOpen }),
    },
  ),
);
