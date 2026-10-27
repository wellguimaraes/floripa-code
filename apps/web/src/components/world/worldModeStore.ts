import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ProjectScript } from "@t3tools/contracts";

import { resolveStorage } from "../../lib/storage";

interface WorldModeState {
  /** Whether the world is on screen right now; it hides on routes like settings. */
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
  /** The latest ask to frame an agent's island; each ask is new, so repeats fly again. */
  readonly islandFocusRequest: { readonly threadKey: string } | null;
  readonly focusIslandOf: (threadKey: string) => void;
  /** An agent whose chat the world just opened; its composer takes focus once it shows. */
  readonly chatFocusRequest: { readonly threadKey: string } | null;
  readonly focusChatOf: (threadKey: string) => void;
  readonly clearChatFocusRequest: () => void;
  /**
   * A script an island's "Run script" picked, waiting for its agent's chat to open and run it in
   * that agent's terminal. `remember` makes a saved command the project's one-click action.
   */
  readonly scriptRun: {
    readonly threadKey: string;
    readonly script: ProjectScript;
    readonly remember: boolean;
  } | null;
  readonly requestScriptRun: (threadKey: string, script: ProjectScript, remember: boolean) => void;
  readonly clearScriptRun: () => void;
  readonly setSidebarWasOpen: (open: boolean | null) => void;
  readonly setShown: (shown: boolean) => void;
}

/** The world's view state, per viewer, so it lives in this browser only. */
export const useWorldModeStore = create<WorldModeState>()(
  persist(
    (set) => ({
      shown: false,
      sidebarWasOpen: null,
      pickingProject: false,
      setPickingProject: (pickingProject) => set({ pickingProject }),
      archiveChatAgent: null,
      setArchiveChatAgent: (archiveChatAgent) => set({ archiveChatAgent }),
      islandFocusRequest: null,
      focusIslandOf: (threadKey) => set({ islandFocusRequest: { threadKey } }),
      chatFocusRequest: null,
      focusChatOf: (threadKey) => set({ chatFocusRequest: { threadKey } }),
      clearChatFocusRequest: () => set({ chatFocusRequest: null }),
      scriptRun: null,
      requestScriptRun: (threadKey, script, remember) =>
        set({ scriptRun: { threadKey, script, remember } }),
      clearScriptRun: () => set({ scriptRun: null }),
      setSidebarWasOpen: (sidebarWasOpen) => set({ sidebarWasOpen }),
      setShown: (shown) => set({ shown }),
    }),
    {
      name: "floripacode:world-mode:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({ sidebarWasOpen: state.sidebarWasOpen }),
    },
  ),
);
