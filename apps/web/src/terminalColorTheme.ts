import { findTerminalTheme } from "@t3tools/shared/terminalThemes";

export const TERMINAL_ANSI_VARIABLES = Array.from(
  { length: 16 },
  (_, index) => `--terminal-ansi-${index}`,
);

/**
 * Overrides the app theme's terminal colors with the chosen terminal theme, or
 * clears the override so the app theme's colors show again. Terminals read
 * these variables and re-theme when the root's style changes.
 */
export function applyTerminalColorTheme(root: HTMLElement, themeId: string): void {
  const scheme = findTerminalTheme(themeId);
  const variables: Array<[string, string | undefined]> = [
    ["--terminal-background", scheme?.background],
    ["--terminal-foreground", scheme?.foreground],
    ["--terminal-cursor", scheme?.cursor],
    ["--terminal-selection-background", scheme?.selectionBackground],
    ...TERMINAL_ANSI_VARIABLES.map((variable, index): [string, string | undefined] => [
      variable,
      scheme?.palette[index],
    ]),
  ];
  for (const [variable, value] of variables) {
    if (value === undefined) root.style.removeProperty(variable);
    else root.style.setProperty(variable, value);
  }
}
