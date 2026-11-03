/**
 * Where a link clicked inside a thread should open.
 *
 * Settings → Integrations → Browser lets the user choose between the OS
 * default browser, a tab in the in-app browser, or being asked on each click.
 * This module turns that preference plus the click itself into one answer, so
 * chat markdown and the terminal drawer make the same decision and offer the
 * same escape hatch.
 *
 * @module browserLinkTarget
 */
import type { BrowserLinkTarget, ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";

import { showContextMenuFallback } from "~/contextMenuFallback";
import {
  ensureClientSettingsHydrated,
  getClientSettings,
  persistClientSettingsPatch,
} from "~/hooks/useSettings";
import { isPreviewAvailableFor } from "./previewRuntime";

export interface ResolveLinkTargetInput {
  readonly url: string;
  /** Cmd/Ctrl-click always goes to the system browser, whatever the default. */
  readonly event: { readonly metaKey: boolean; readonly ctrlKey: boolean };
  readonly preference: BrowserLinkTarget;
  /** Whether this client has an in-app browser and a thread to open it beside. */
  readonly canOpenInApp: boolean;
}

/**
 * The target a click resolves to. "app" or "ask" only comes back when the
 * preference says so, the runtime can honour it, the URL is one the in-app
 * browser can load, and the click carried no modifier — the modifier is the
 * one-gesture way out, mirroring how change-request links already treat it.
 * "ask" means the caller should settle it with `askLinkTarget`.
 */
export function resolveLinkTarget(input: ResolveLinkTargetInput): BrowserLinkTarget {
  if (input.event.metaKey || input.event.ctrlKey) return "system";
  if (input.preference === "system") return "system";
  if (!input.canOpenInApp) return "system";
  if (!isWebUrl(input.url)) return "system";
  return input.preference;
}

type LinkTargetChoice = "app" | "system" | "always-app" | "always-system";

const LINK_TARGET_CHOICES = [
  { id: "app", label: "Open in Floripa Code" },
  { id: "system", label: "Open in default browser" },
  { id: "always-app", label: "Always open in Floripa Code", separatorBefore: true },
  { id: "always-system", label: "Always open in default browser" },
] as const satisfies readonly ContextMenuItem<LinkTargetChoice>[];

/**
 * Asks where one link should open, at the click. The "Always…" rows save the
 * answer as the "Open links in" setting, so the prompt stops once the user
 * has made up their mind; Settings is where they change it back to asking.
 * Resolves null when the menu is dismissed, which means the click does nothing.
 */
export async function askLinkTarget(position: {
  readonly x: number;
  readonly y: number;
}): Promise<"app" | "system" | null> {
  const choice = await showContextMenuFallback(LINK_TARGET_CHOICES, position);
  if (choice === "always-app" || choice === "always-system") {
    const target = choice === "always-app" ? "app" : "system";
    void persistClientSettingsPatch({ browserLinkTarget: target });
    return target;
  }
  return choice;
}

/**
 * Where to put the prompt for a click. Keyboard activation (detail 0) carries
 * no pointer position, so the prompt sits under the link instead.
 */
export function linkTargetPromptPosition(event: {
  readonly clientX: number;
  readonly clientY: number;
  readonly detail: number;
  readonly currentTarget: EventTarget | null;
}): { readonly x: number; readonly y: number } {
  if (event.detail === 0 && event.currentTarget instanceof Element) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  }
  return { x: event.clientX, y: event.clientY };
}

/**
 * Only http(s) can load in the in-app browser. Anything else — mailto:,
 * vscode://, a bare fragment — belongs to the shell whatever the preference.
 */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The configured default, once client settings have actually loaded. Before
 * hydration the snapshot is the schema default ("system"), so a link clicked
 * in the first moments after launch would ignore a persisted "app" — opening
 * is asynchronous anyway, so waiting costs nothing the user can see.
 * Read failures reject rather than choosing a browser without the saved preference.
 */
export async function resolveBrowserLinkTargetPreference(): Promise<BrowserLinkTarget> {
  await ensureClientSettingsHydrated();
  return getClientSettings().browserLinkTarget;
}

/** Whether this thread's environment has an in-app browser available to this client. */
export function canOpenLinksInApp(threadRef: ScopedThreadRef | null | undefined): boolean {
  return threadRef != null && isPreviewAvailableFor(threadRef.environmentId);
}
