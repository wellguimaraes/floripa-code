import { create } from "zustand";

export interface WorldLook {
  /** Index into `palette.families`. */
  readonly hue: number;
  /** The worktree's hat; null in the project checkout. */
  readonly hat: number | null;
  /** The island sign's colour, and the text colour that reads on it. */
  readonly plate: { readonly background: string; readonly text: string };
}

interface WorldLookState {
  /** How each character looks in the world right now, by thread key. Empty while the world is closed. */
  readonly looks: ReadonlyMap<string, WorldLook>;
  readonly setLooks: (looks: ReadonlyMap<string, WorldLook>) => void;
}

/** The world shares its characters' looks, so the chat can show who you are talking to. */
export const useWorldLookStore = create<WorldLookState>()((set) => ({
  looks: new Map(),
  setLooks: (looks) => set({ looks }),
}));

/** The thread's character look, or null when the world doesn't show it. */
export function useWorldLook(threadKey: string): WorldLook | null {
  const hue = useWorldLookStore((state) => state.looks.get(threadKey)?.hue);
  const hat = useWorldLookStore((state) => state.looks.get(threadKey)?.hat ?? null);
  const plate = useWorldLookStore((state) => state.looks.get(threadKey)?.plate);
  return hue === undefined || plate === undefined ? null : { hue, hat, plate };
}
