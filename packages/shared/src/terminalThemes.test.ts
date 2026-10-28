import { describe, expect, it } from "vite-plus/test";

import { findTerminalTheme, TERMINAL_THEMES } from "./terminalThemes";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const value = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

describe("TERMINAL_THEMES", () => {
  it("has unique ids", () => {
    const ids = TERMINAL_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("splits evenly into light and dark groups", () => {
    const dark = TERMINAL_THEMES.filter((theme) => theme.appearance === "dark");
    expect(dark.length * 2).toBe(TERMINAL_THEMES.length);
  });

  // Guards a regeneration from upstream against schemes agent output cannot be read in.
  it.each(TERMINAL_THEMES)("$name is readable and matches its appearance", (theme) => {
    expect(luminance(theme.background) < 0.18).toBe(theme.appearance === "dark");
    // Solarized Light sits at 4.1:1 by design, so the floor is just under AA.
    expect(contrast(theme.foreground, theme.background)).toBeGreaterThanOrEqual(4);
    expect(contrast(theme.foreground, theme.selectionBackground)).toBeGreaterThanOrEqual(2);
  });
});

describe("findTerminalTheme", () => {
  it("uses the app theme for an empty or unknown id", () => {
    expect(findTerminalTheme("")).toBeNull();
    expect(findTerminalTheme("from-a-newer-client")).toBeNull();
  });

  it("finds a theme by id regardless of the app's appearance", () => {
    expect(findTerminalTheme("catppuccin-mocha")).toMatchObject({
      name: "Catppuccin Mocha",
      appearance: "dark",
    });
  });
});
