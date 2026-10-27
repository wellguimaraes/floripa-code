import type { DesktopBridge, DesktopUpdateState } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";

import { ensureLocalApi } from "../localApi";
import {
  getDesktopUpdateActionError,
  getDesktopUpdateDownloadedVersion,
  getDesktopUpdateInstallConfirmationMessage,
  getDesktopUpdateReleaseUrl,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { stackedThreadToast, toastManager } from "./ui/toast";

type DesktopUpdateShell = Pick<DesktopBridge, "openExternal">;

export async function openDesktopUpdateReleaseNotes(
  shell: DesktopUpdateShell | undefined,
  releaseUrl: string,
): Promise<void> {
  try {
    if (shell && (await shell.openExternal(releaseUrl))) return;
  } catch {
    // Surface rejected IPC calls through the same user-visible fallback.
  }
  toastManager.add({ type: "error", title: "Unable to open release notes" });
}

function ReleaseNotesLink({
  shell,
  releaseUrl,
}: {
  shell: DesktopUpdateShell;
  releaseUrl: string;
}) {
  return (
    <button
      className="ml-2 inline cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
      onClick={() => {
        void openDesktopUpdateReleaseNotes(shell, releaseUrl);
      }}
      type="button"
    >
      Read more
      <ArrowRightIcon
        aria-hidden
        className="ml-1 inline size-3 -rotate-45 align-[-0.125em]"
        strokeWidth={2.25}
      />
    </button>
  );
}

export function showDesktopUpdateDownloadedToast(
  shell: DesktopUpdateShell,
  state: DesktopUpdateState,
): void {
  const releaseUrl = getDesktopUpdateReleaseUrl(getDesktopUpdateDownloadedVersion(state));
  toastManager.add({
    type: "success",
    title: "Update downloaded",
    description: (
      <>
        Restart the app from the update button to install it.
        {releaseUrl ? <ReleaseNotesLink releaseUrl={releaseUrl} shell={shell} /> : null}
      </>
    ),
  });
}

function toastUpdateError(title: string, description: string): void {
  toastManager.add(stackedThreadToast({ type: "error", title, description }));
}

/** Downloads the available update, toasting when it lands or fails. */
export async function downloadDesktopUpdate(bridge: DesktopBridge): Promise<void> {
  try {
    const result = await bridge.downloadUpdate();
    if (result.completed) showDesktopUpdateDownloadedToast(bridge, result.state);
    if (!shouldToastDesktopUpdateActionResult(result)) return;
    const actionError = getDesktopUpdateActionError(result);
    if (actionError) toastUpdateError("Could not download update", actionError);
  } catch (error) {
    toastUpdateError(
      "Could not start update download",
      error instanceof Error ? error.message : "An unexpected error occurred.",
    );
  }
}

/** Asks before restarting, since installing interrupts running tasks, then installs. */
export async function confirmAndInstallDesktopUpdate(
  bridge: DesktopBridge,
  state: DesktopUpdateState,
): Promise<void> {
  let confirmed = false;
  try {
    confirmed = await ensureLocalApi().dialogs.confirm(
      getDesktopUpdateInstallConfirmationMessage(state),
    );
  } catch (error) {
    toastUpdateError(
      "Could not confirm update",
      error instanceof Error ? error.message : "Update confirmation failed.",
    );
    return;
  }
  if (!confirmed) return;
  try {
    const result = await bridge.installUpdate();
    if (!shouldToastDesktopUpdateActionResult(result)) return;
    const actionError = getDesktopUpdateActionError(result);
    if (actionError) toastUpdateError("Could not install update", actionError);
  } catch (error) {
    toastUpdateError(
      "Could not install update",
      error instanceof Error ? error.message : "An unexpected error occurred.",
    );
  }
}
