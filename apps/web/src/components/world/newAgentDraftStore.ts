import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";
import type { WorldAgentSetup, WorldAgentWorkspace } from "./useStartWorldAgent";

/** A new agent's task, kept when its bubble closed before the agent started. Files are not kept. */
export interface NewAgentDraft {
  readonly text: string;
  /** Where it works; null when nothing was picked (outside a repo). */
  readonly workspace: WorldAgentWorkspace | null;
  readonly hue: number;
  /** The model, traits and modes picked over the defaults. */
  readonly picked: Partial<WorldAgentSetup>;
}

interface NewAgentDraftState {
  /** By the island's project group key. */
  readonly drafts: Readonly<Record<string, NewAgentDraft>>;
  readonly keep: (islandKey: string, draft: NewAgentDraft) => void;
  readonly drop: (islandKey: string) => void;
}

/**
 * One kept draft per island; the island's next new-agent bubble opens on it.
 * Per viewer, so it lives in this browser only.
 */
export const useNewAgentDraftStore = create<NewAgentDraftState>()(
  persist(
    (set) => ({
      drafts: {},
      keep: (islandKey, draft) =>
        set((state) => ({ drafts: { ...state.drafts, [islandKey]: draft } })),
      drop: (islandKey) =>
        set((state) => {
          if (!(islandKey in state.drafts)) return state;
          const { [islandKey]: _, ...rest } = state.drafts;
          return { drafts: rest };
        }),
    }),
    {
      name: "floripacode:world-new-agent-drafts:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ drafts: state.drafts }),
    },
  ),
);
