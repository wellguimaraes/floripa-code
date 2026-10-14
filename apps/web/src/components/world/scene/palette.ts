/**
 * World colors. The 3D scene keeps its own daylight look in every app theme,
 * so these are game colors, not theme tokens; restyle the world here.
 */
export const palette = {
  sky: "#8fd3f4",
  skyLight: "#ffffff",
  groundLight: "#7fae7a",
  // Sea, lagoon, shallows, sand, and grass follow the Atoll logo's rings.
  water: "#0c5b87",
  // Clear water over sand: pale cyan by the shore, brighter blue further out.
  shallows: "#7ee9f0",
  lagoon: "#1b7bb1",
  sand: "#fff3c3",
  grass: "#65c272",
  grassBank: "#55ad63",
  /** Bands on the lawn from its edge in, each a little lighter (see `Island`). */
  lawnBands: ["#6cc878", "#74ce7e", "#7cd384"],
  path: "#d9c7a0",
  shadow: "#0f172a",
  selection: "#ffffff",
  approval: "#f59e0b",
  question: "#38bdf8",
  balloonText: "#0f172a",
  balloonRim: "#ffffff",
  balloonString: "#334155",
  eye: "#111827",
  cloud: "#6b7280",
  towel: "#f87171",
  towelStripe: "#fef2f2",
  palmTrunk: "#a16207",
  palmTrunkDark: "#854d0e",
  palmLeaf: "#16a34a",
  palmLeafDark: "#15803d",
  coconut: "#78350f",
  chairFrame: "#f5f5f4",
  chairCushion: "#38bdf8",
  treeTrunk: "#92400e",
  treeLeaf: "#22a35a",
  // Sand scenery from the KayKit pack, shaded light at the top to dark below (see `nature.ts`).
  leafLight: "#9ad35b",
  leafDark: "#2e8b47",
  signPost: "#7c4a21",
  signTextDark: "#1f1408",
  signTextLight: "#ffffff",
  foam: "#ffffff",
  ufoHull: "#4a5059",
  ufoDome: "#7dd3fc",
  ufoLight: "#fde047",
  ufoBeam: "#a3f7b5",
  metal: "#94a3b8",
  stone: "#7c8089",
  stoneDark: "#5f636b",
  stoneLight: "#a3a7ae",
  sharkFin: "#3f4c5a",
  gold: "#facc15",
  rod: "#5b3a1e",
  plank: "#a58a70",
  plankDark: "#745c48",
  fishingLine: "#e2e8f0",
  bobber: "#ef4444",
  /**
   * Character colours, one per family: head in the light shade, body and arms
   * in the base, legs in the dark. Hues are far apart so families read at a glance.
   */
  families: [
    { light: "#fca5a5", base: "#ef4444", dark: "#b91c1c" },
    { light: "#fdba74", base: "#f97316", dark: "#c2410c" },
    { light: "#fde047", base: "#eab308", dark: "#a16207" },
    { light: "#bef264", base: "#65a30d", dark: "#3f6212" },
    { light: "#5eead4", base: "#0d9488", dark: "#115e59" },
    { light: "#7dd3fc", base: "#0ea5e9", dark: "#0369a1" },
    { light: "#a5b4fc", base: "#4f46e5", dark: "#3730a3" },
    { light: "#d8b4fe", base: "#a855f7", dark: "#7e22ce" },
    { light: "#f9a8d4", base: "#ec4899", dark: "#be185d" },
    { light: "#e7e5e4", base: "#78716c", dark: "#44403c" },
  ],
  /** Worktree hats; see `Hat`. */
  hats: {
    hardHat: "#f97316",
    hardHatRidge: "#c2410c",
    straw: "#f2d58a",
    strawBand: "#b45309",
    topHat: "#1f2937",
    topHatBand: "#dc2626",
    beanie: "#2563eb",
    beanieCuff: "#f8fafc",
    party: "#d946ef",
    partyPuff: "#fde047",
  },
  /** One per project, picked by the project's key; the island's plate shows it at the shore. */
  plates: ["#f97316", "#8b5cf6", "#ec4899", "#14b8a6", "#eab308", "#ef4444", "#3b82f6", "#22c55e"],
} as const;

export type FamilyShades = (typeof palette.families)[number];
