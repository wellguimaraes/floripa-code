import { requestConfirmDialog } from "~/confirmDialog";
import { readLocalApi } from "~/localApi";

let pendingConfirmations = 0;

/** Whether a terminal-close confirmation is currently waiting on the user. */
export function isTerminalCloseConfirmPending(): boolean {
  return pendingConfirmations > 0;
}

/**
 * Confirmation for individual terminal close actions: drawer buttons, panel
 * buttons, the `terminal.close` keybinding, and closing a terminal surface from
 * the tab strip. Auto-exit cleanup and bulk tab closes skip this path and close
 * directly. A click passes its button as `anchor`, so the confirmation opens beside it.
 *
 * `labels` names only the closing terminals with a running subprocess; with none,
 * an idle shell has nothing to lose, so the close goes through without asking.
 */
export async function confirmTerminalClose(
  labels: readonly string[],
  anchor?: Element | null,
): Promise<boolean> {
  if (labels.length === 0) return true;
  const localApi = readLocalApi();
  if (!localApi) return true;
  pendingConfirmations += 1;
  try {
    const message =
      labels.length === 1
        ? [
            `Close terminal "${labels[0]}"?`,
            "This stops the running process and clears its history.",
          ].join("\n")
        : [
            `Close ${labels.length} terminals?`,
            `This stops their running processes and clears their histories: ${labels
              .map((label) => `"${label}"`)
              .join(", ")}.`,
          ].join("\n");
    if (anchor) {
      const anchored = requestConfirmDialog(message, { variant: "destructive", anchor });
      if (anchored) return await anchored;
    }
    return await localApi.dialogs.confirm(message, { variant: "destructive" });
  } catch {
    return false;
  } finally {
    pendingConfirmations -= 1;
  }
}
