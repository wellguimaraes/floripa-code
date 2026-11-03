import { useEffect, useRef } from "react";

import { isConfirmDialogActive, requestConfirmChoice } from "../../confirmDialog";
import { getClientSettings, persistClientSettingsPatch } from "../../hooks/useSettings";
import { formatShortcutLabel } from "../../keybindings";

// Option+A on a Mac, Alt+A elsewhere.
export const ARCHIVE_SHORTCUT = formatShortcutLabel({
  key: "a",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: true,
  modKey: false,
});

/**
 * Option/Alt+A runs `archive` from anywhere while `enabled`. Matched on the physical key, since
 * Option+A types "å" on a Mac, and caught first so a text box never gets that letter.
 */
export function useArchiveShortcut(archive: () => Promise<void>, enabled = true): void {
  const archiveOnShortcut = useRef(archive);
  useEffect(() => {
    archiveOnShortcut.current = archive;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyA" || !event.altKey) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      void archiveOnShortcut.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}

/**
 * Asks before archiving unless the user chose "Don't ask again" (Settings turns it back on).
 * A click asks in a popover beside `anchor`, the archive button; the shortcut passes null and
 * asks in a centered dialog. A second shortcut press while it is open is ignored, not queued.
 */
export async function confirmArchive(anchor: Element | null): Promise<boolean> {
  if (isConfirmDialogActive()) return false;
  if (!getClientSettings().confirmWorldArchive) return true;
  const choice = requestConfirmChoice(
    "Archive this thread?\nYou can restore it by clicking the island billboard and choosing Restore archived agent…, or from Settings → Archived.",
    { anchor, rememberLabel: "Don't ask again" },
  );
  // No themed host is mounted; fall back to the native prompt rather than archiving unasked.
  if (choice === undefined) return window.confirm("Archive this thread?");
  const { confirmed, remember } = await choice;
  if (confirmed && remember) void persistClientSettingsPatch({ confirmWorldArchive: false });
  return confirmed;
}
