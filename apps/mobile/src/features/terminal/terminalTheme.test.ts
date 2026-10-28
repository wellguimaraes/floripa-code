import { describe, expect, it } from "vite-plus/test";
import { TERMINAL_THEMES } from "@t3tools/shared/terminalThemes";
import { BUILT_IN_THEMES, getThemeColorsForAppearance } from "@t3tools/shared/themePalettes";

import { themeColorToNativeColor } from "../../lib/mobileTheme";

import { buildGhosttyThemeConfig, getMobileTerminalTheme } from "./terminalTheme";

describe("getMobileTerminalTheme", () => {
  it("uses the shared default light terminal colors", () => {
    expect(getMobileTerminalTheme("floripa-code", "light")).toMatchObject({
      background: "#fcfcfc",
      foreground: "#27272a",
      cursorForeground: "#26384e",
      cursorBackground: "#fcfcfc",
    });
  });

  it("uses the shared default dark terminal colors", () => {
    expect(getMobileTerminalTheme("floripa-code", "dark")).toMatchObject({
      background: "#0a0a0a",
      foreground: "#f5f5f5",
      cursorForeground: "#b4cbff",
      cursorBackground: "#0a0a0a",
    });
  });
  it("applies the selected palette without replacing ANSI status colors", () => {
    const standard = getMobileTerminalTheme("floripa-code", "dark");
    const ocean = getMobileTerminalTheme("ocean", "dark");

    expect(ocean.background).not.toBe(standard.background);
    expect(ocean.cursorForeground).not.toBe(standard.cursorForeground);
    expect(ocean.palette).toEqual(standard.palette);
  });

  it("uses the canonical desktop terminal roles for built-in themes", () => {
    const theme = BUILT_IN_THEMES.find((candidate) => candidate.id === "ocean")!;
    const colors = getThemeColorsForAppearance(theme, "dark")!;
    const terminal = getMobileTerminalTheme("ocean", "dark");

    expect(terminal.background).toBe(themeColorToNativeColor(colors.terminalBackground));
    expect(terminal.foreground).toBe(themeColorToNativeColor(colors.terminalForeground));
    expect(terminal.cursorForeground).toBe(themeColorToNativeColor(colors.terminalCursor));
  });
});

describe("getMobileTerminalTheme with a terminal theme", () => {
  it("uses the chosen scheme even when the app's appearance differs", () => {
    const nord = TERMINAL_THEMES.find((theme) => theme.id === "nord")!;
    const terminal = getMobileTerminalTheme("ocean", "light", "nord");

    expect(nord.appearance).toBe("dark");
    expect(terminal.background).toBe(nord.background);
    expect(terminal.foreground).toBe(nord.foreground);
    expect(terminal.palette).toEqual(nord.palette);
  });

  it("falls back to the app theme for an unknown id", () => {
    expect(getMobileTerminalTheme("ocean", "dark", "gone")).toEqual(
      getMobileTerminalTheme("ocean", "dark"),
    );
  });
});

describe("buildGhosttyThemeConfig", () => {
  it("serializes theme colors into a ghostty config file", () => {
    const config = buildGhosttyThemeConfig(getMobileTerminalTheme("floripa-code", "dark"));

    expect(config).toContain("background = #0a0a0a");
    expect(config).toContain("foreground = #f5f5f5");
    expect(config).toContain("cursor-color = #b4cbff");
    expect(config).toContain("palette = 0=#141415");
    expect(config).toContain("palette = 15=#c6c6c8");
    expect(config.endsWith("\n")).toBe(true);
  });
});
