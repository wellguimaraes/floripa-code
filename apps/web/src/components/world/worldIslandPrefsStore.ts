import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import { hashString } from "./engine/hash";
import { palette } from "./scene/palette";

export interface IslandPrefs {
  /** The sign's colour; the island's own pick from `palette.plates` when left out. */
  readonly color?: string;
  /**
   * Days without a commit after which a branch reads as stale, or never.
   * `DEFAULT_STALE_DAYS` when left out.
   */
  readonly staleDays?: number | "never";
  /** Minutes with nobody on the island busy after which it ripples for you. Off when left out. */
  readonly idleAlarmMinutes?: number;
}

/** A change to an island's preferences; null puts a field back to its default. */
export type IslandPrefsPatch = { readonly [K in keyof IslandPrefs]?: IslandPrefs[K] | null };

interface WorldIslandPrefsState {
  /** By the island's project group key. */
  readonly prefs: Readonly<Record<string, IslandPrefs>>;
  readonly update: (key: string, patch: IslandPrefsPatch) => void;
}

/** Each island's sign colour, stale threshold and idle alarm. Per viewer, so it lives in this browser only. */
export const useWorldIslandPrefsStore = create<WorldIslandPrefsState>()(
  persist(
    (set) => ({
      prefs: {},
      update: (key, patch) =>
        set((state) => {
          const merged: Record<string, unknown> = { ...state.prefs[key], ...patch };
          for (const field of Object.keys(merged)) {
            if (merged[field] === null || merged[field] === undefined) delete merged[field];
          }
          const { [key]: _, ...rest } = state.prefs;
          return {
            prefs: Object.keys(merged).length === 0 ? rest : { ...rest, [key]: merged },
          };
        }),
    }),
    {
      name: "floripacode:world-island-prefs:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ prefs: state.prefs }),
    },
  ),
);

/** How many days without a commit make a branch stale, unless picked otherwise. */
export const DEFAULT_STALE_DAYS = 14;

/** Days without a commit after which an island's branches go stale; null for never. */
export function islandStaleDays(prefs: IslandPrefs | undefined): number | null {
  const days = prefs?.staleDays ?? DEFAULT_STALE_DAYS;
  return days === "never" ? null : days;
}

/** The island's own sign colour, picked by its key. */
export function defaultIslandPlate(key: string): string {
  return palette.plates[hashString(key) % palette.plates.length]!;
}

/** An island's sign colour: the one picked for it, else its own. */
export function islandPlate(key: string, prefs: IslandPrefs | undefined): string {
  return prefs?.color ?? defaultIslandPlate(key);
}
