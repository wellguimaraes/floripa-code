import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldHueState {
  /** Family colour picked when starting an agent, by its thread id (the family's seed). */
  readonly chosen: Readonly<Record<string, number>>;
  /** `release` drops other families' picks, so they move to a free colour. */
  readonly choose: (threadId: string, hue: number, release?: ReadonlyArray<string>) => void;
}

/** Colours people picked for their agents. Per viewer, so it lives in this browser only. */
export const useWorldHueStore = create<WorldHueState>()(
  persist(
    (set) => ({
      chosen: {},
      choose: (threadId, hue, release = []) =>
        set((state) => {
          const chosen: Record<string, number> = { ...state.chosen, [threadId]: hue };
          for (const id of release) if (id !== threadId) delete chosen[id];
          return { chosen };
        }),
    }),
    {
      name: "floripacode:world-hues:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ chosen: state.chosen }),
    },
  ),
);
