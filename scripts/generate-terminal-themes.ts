#!/usr/bin/env node
// Regenerates packages/shared/src/terminalThemes.ts from the Ghostty theme
// files in mbadolato/iTerm2-Color-Schemes. The list is hand-curated from
// well-known families. Fetch the source once, then point this script at it:
//
//   git clone --depth 1 --filter=blob:none --sparse \
//     https://github.com/mbadolato/iTerm2-Color-Schemes /tmp/iterm2-schemes
//   git -C /tmp/iterm2-schemes sparse-checkout set ghostty
//   node scripts/generate-terminal-themes.ts /tmp/iterm2-schemes

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

// Each family contributes a dark and a light variant, so either kind of
// terminal is available. `file` is the upstream name when the display name differs.
const FAMILIES: ReadonlyArray<{
  dark: { name: string; file?: string };
  light: { name: string; file?: string };
}> = [
  { dark: { name: "Catppuccin Mocha" }, light: { name: "Catppuccin Latte" } },
  {
    dark: { name: "Rosé Pine", file: "Rose Pine" },
    light: { name: "Rosé Pine Dawn", file: "Rose Pine Dawn" },
  },
  {
    dark: { name: "Tokyo Night Storm", file: "TokyoNight Storm" },
    light: { name: "Tokyo Night Day", file: "TokyoNight Day" },
  },
  {
    dark: { name: "GitHub Dark", file: "GitHub Dark Default" },
    light: { name: "GitHub Light", file: "GitHub Light Default" },
  },
  { dark: { name: "Gruvbox Dark" }, light: { name: "Gruvbox Light" } },
  {
    dark: { name: "Everforest Dark", file: "Everforest Dark Med" },
    light: { name: "Everforest Light", file: "Everforest Light Med" },
  },
  { dark: { name: "Kanagawa Wave" }, light: { name: "Kanagawa Lotus" } },
  { dark: { name: "Nord" }, light: { name: "Nord Light" } },
  { dark: { name: "One Half Dark" }, light: { name: "One Half Light" } },
  { dark: { name: "Atom One Dark" }, light: { name: "Atom One Light" } },
  { dark: { name: "Ayu Mirage" }, light: { name: "Ayu Light" } },
  {
    dark: { name: "Solarized Dark", file: "iTerm2 Solarized Dark" },
    light: { name: "Solarized Light", file: "iTerm2 Solarized Light" },
  },
  { dark: { name: "Flexoki Dark" }, light: { name: "Flexoki Light" } },
  { dark: { name: "Night Owl" }, light: { name: "Light Owl" } },
  { dark: { name: "Monokai Pro" }, light: { name: "Monokai Pro Light" } },
  { dark: { name: "Melange Dark" }, light: { name: "Melange Light" } },
  { dark: { name: "Zenbones Dark" }, light: { name: "Zenbones Light" } },
  { dark: { name: "Nightfox" }, light: { name: "Dawnfox" } },
];

const OUTPUT = new URL("../packages/shared/src/terminalThemes.ts", import.meta.url);
const HEX = /^#[0-9a-f]{6}$/;

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = rgb(hex).map((channel) => {
      const value = channel / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function mix(from: string, to: string, amount: number): string {
  const a = rgb(from);
  const b = rgb(to);
  return `#${a
    .map((channel, index) =>
      Math.round(channel + (b[index]! - channel) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// Clients paint selected text in the normal foreground (no selection-foreground),
// so a selection color chosen for inverted text is blended toward the background.
function readableSelection(selection: string, background: string, foreground: string): string {
  return contrast(selection, foreground) >= 3 ? selection : mix(background, selection, 0.35);
}

function readScheme(sourceRoot: string, file: string) {
  const values = new Map<string, string>();
  const palette: string[] = [];
  for (const line of NodeFS.readFileSync(NodePath.join(sourceRoot, "ghostty", file), "utf8").split(
    "\n",
  )) {
    const match = line.match(/^([a-z-]+)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, raw] = match as unknown as [string, string, string];
    if (key === "palette") {
      const [index, color] = raw.split("=");
      palette[Number(index)] = color!.trim().toLowerCase();
    } else {
      values.set(key, raw.trim().toLowerCase());
    }
  }
  const background = values.get("background");
  const foreground = values.get("foreground");
  const colors = palette.slice(0, 16);
  if (!background || !foreground || colors.length !== 16) {
    throw new Error(`${file}: missing background, foreground, or the 16 ANSI colors`);
  }
  const scheme = {
    background,
    foreground,
    cursor: values.get("cursor-color") ?? foreground,
    selectionBackground: readableSelection(
      values.get("selection-background") ?? colors[8]!,
      background,
      foreground,
    ),
    palette: colors,
  };
  for (const color of [
    background,
    foreground,
    scheme.cursor,
    scheme.selectionBackground,
    ...colors,
  ]) {
    if (!HEX.test(color)) throw new Error(`${file}: unexpected color ${color}`);
  }
  return scheme;
}

function kebab(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const sourceRoot = process.argv[2];
if (!sourceRoot) {
  console.error("usage: node scripts/generate-terminal-themes.ts <iTerm2-Color-Schemes checkout>");
  process.exit(1);
}
const revision = NodeChildProcess.execFileSync(
  "git",
  ["-C", sourceRoot, "rev-parse", "--short", "HEAD"],
  {
    encoding: "utf8",
  },
).trim();

const themes = (["light", "dark"] as const)
  .flatMap((appearance) =>
    FAMILIES.map(({ [appearance]: variant }) => ({
      id: kebab(variant.name),
      name: variant.name,
      appearance,
      ...readScheme(sourceRoot, variant.file ?? variant.name),
    })),
  )
  .sort((a, b) => a.name.localeCompare(b.name));

NodeFS.writeFileSync(
  OUTPUT,
  `// Generated by scripts/generate-terminal-themes.ts from
// https://github.com/mbadolato/iTerm2-Color-Schemes (MIT) at ${revision}.
// Each scheme keeps the copyright of its original author. Do not edit by hand.

export type TerminalAnsiPalette = readonly [
${"  string,\n".repeat(16)}];

export interface TerminalColorScheme {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly selectionBackground: string;
  /** The 16 ANSI colors, in order. */
  readonly palette: TerminalAnsiPalette;
}

/** A terminal color theme, usable whatever the app's own appearance is. */
export interface TerminalTheme extends TerminalColorScheme {
  readonly id: string;
  readonly name: string;
  /** Whether the theme has a light or dark background. */
  readonly appearance: "light" | "dark";
}

export const TERMINAL_THEMES: readonly TerminalTheme[] = ${JSON.stringify(themes, null, 2)};

/** The theme for a stored id, or null for "use the app theme" and unknown ids. */
export function findTerminalTheme(themeId: string): TerminalTheme | null {
  return TERMINAL_THEMES.find((theme) => theme.id === themeId) ?? null;
}
`,
);
console.log(`Wrote ${themes.length} terminal themes from ${revision}`);
