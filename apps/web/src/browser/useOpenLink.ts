import { AuthPreviewOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useCallback } from "react";

import { recordVisitForThread } from "~/browserHistoryStore";
import { readLocalApi } from "~/localApi";
import { previewEnvironment } from "~/state/preview";
import { readEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  askLinkTarget,
  canOpenLinksInApp,
  linkTargetPromptPosition,
  resolveBrowserLinkTargetPreference,
  resolveLinkTarget,
} from "./browserLinkTarget";
import { BrowserSettingsReadError, openUrlInPreview } from "./openFileInPreview";

const NO_MODIFIER = { metaKey: false, ctrlKey: false } as const;

/**
 * Opens a URL where the "Open links in" setting says, for buttons that sit
 * beside a thread but are not markdown anchors: CI check details, a pull
 * request that has no project to open in the panel. Without a thread there is
 * nowhere to put an in-app tab, so the link goes to the system browser.
 *
 * The "ask" setting needs a click to put its prompt beside; called without
 * one (a toast action, a link handed over by the desktop shell) it opens in
 * the system browser, as it did before the prompt existed.
 *
 * An in-app open that fails falls back to the system browser rather than
 * dropping the click: the user asked for the link, and the setting only says
 * where it should go first. Failed settings reads reject without opening a
 * browser. The promise also rejects if the system-browser fallback fails.
 */
export function useOpenLink(threadRef: ScopedThreadRef | null | undefined): (
  url: string,
  options?: {
    readonly event?: {
      readonly metaKey: boolean;
      readonly ctrlKey: boolean;
      readonly clientX?: number;
      readonly clientY?: number;
      readonly detail?: number;
      readonly currentTarget?: EventTarget | null;
    };
    /** Thread to open beside when it is not the hook's own, e.g. a sidebar row's. */
    readonly threadRef?: ScopedThreadRef | undefined;
  },
) => Promise<void> {
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  return useCallback(
    async (url, options = {}) => {
      const targetThreadRef = options.threadRef ?? threadRef;
      const event = options.event ?? NO_MODIFIER;
      // Read now: React clears `currentTarget` once the handler returns.
      const promptPosition =
        "clientX" in event && event.clientX !== undefined && event.clientY !== undefined
          ? linkTargetPromptPosition({
              clientX: event.clientX,
              clientY: event.clientY,
              detail: event.detail ?? 1,
              currentTarget: event.currentTarget ?? null,
            })
          : null;
      const resolved = resolveLinkTarget({
        url,
        event,
        preference: await resolveBrowserLinkTargetPreference(),
        canOpenInApp:
          targetThreadRef != null &&
          readEnvironmentScope(targetThreadRef.environmentId, AuthPreviewOperateScope) &&
          canOpenLinksInApp(targetThreadRef),
      });
      const target =
        resolved !== "ask"
          ? resolved
          : promptPosition === null
            ? "system"
            : await askLinkTarget(promptPosition);
      if (target === null) return;
      if (target === "app" && targetThreadRef) {
        const result = await openUrlInPreview({ threadRef: targetThreadRef, url, openPreview });
        if (isAtomCommandInterrupted(result)) return;
        if (result._tag === "Success") {
          recordVisitForThread(targetThreadRef, url);
          return;
        }
        const failure = squashAtomCommandFailure(result);
        if (failure instanceof BrowserSettingsReadError) throw failure;
        console.error(result.cause);
      }
      const api = readLocalApi();
      if (!api) throw new Error("Link opening is unavailable.");
      await api.shell.openExternal(url);
    },
    [openPreview, threadRef],
  );
}
