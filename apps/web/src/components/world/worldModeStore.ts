import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "../../lib/storage";

interface WorldModeState {
  readonly enabled: boolean;
  /** Whether the world is on screen right now; enabled worlds hide on routes like settings. */
  readonly shown: boolean;
  /** Whether the sidebar was open before the world collapsed it, to reopen it on the way out. */
  readonly sidebarWasOpen: boolean | null;
  /** Whether the new-agent shortcut's project picker is open; the world shows it. */
  readonly pickingProject: boolean;
  readonly setPickingProject: (picking: boolean) => void;
  /**
   * Archives the agent whose chat is open the world's way: its saucer exit, then the chat
   * closes. Set while the world shows that agent.
   */
  readonly archiveChatAgent: (() => Promise<void>) | null;
  readonly setArchiveChatAgent: (archive: (() => Promise<void>) | null) => void;
  readonly setSidebarWasOpen: (open: boolean | null) => void;
  readonly setShown: (shown: boolean) => void;
  readonly setEnabled: (enabled: boolean) => void;
  readonly toggle: () => void;
}

/** Whether the chat layout shows the world. Per viewer, so it lives in this browser only. */
export const useWorldModeStore = create<WorldModeState>()(
  persist(
    (set) => ({
      enabled: false,
      shown: false,
      sidebarWasOpen: null,
      pickingProject: false,
      setPickingProject: (pickingProject) => set({ pickingProject }),
      archiveChatAgent: null,
      setArchiveChatAgent: (archiveChatAgent) => set({ archiveChatAgent }),
      setSidebarWasOpen: (sidebarWasOpen) => set({ sidebarWasOpen }),
      setShown: (shown) => set({ shown }),
      setEnabled: (enabled) => set({ enabled }),
      toggle: () => set((state) => ({ enabled: !state.enabled })),
    }),
    {
      name: "t3code:world-mode:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ enabled: state.enabled, sidebarWasOpen: state.sidebarWasOpen }),
    },
  ),
);
