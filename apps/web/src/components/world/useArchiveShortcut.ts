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
 * Asks before archiving `count` threads from the world when either archive confirmation setting
 * is on. "Don't ask again" clears only the world one, so it is offered only when the general one
 * is off. A click asks in a popover beside `anchor`, the archive button; the shortcut and the
 * map's menu pass null and ask in a centered dialog. A second request while one is open is
 * ignored, not queued.
 */
export async function confirmArchive(anchor: Element | null, count = 1): Promise<boolean> {
  if (isConfirmDialogActive()) return false;
  const { confirmThreadArchive, confirmWorldArchive } = getClientSettings();
  if (!confirmThreadArchive && !confirmWorldArchive) return true;
  const question = count === 1 ? "Archive this thread?" : `Archive ${count} threads?`;
  const choice = requestConfirmChoice(
    `${question}\nYou can restore ${count === 1 ? "it" : "them"} by clicking the island billboard and choosing Restore archived agent…, or from Settings → Archived.`,
    { anchor, ...(confirmThreadArchive ? {} : { rememberLabel: "Don't ask again" }) },
  );
  // No themed host is mounted; fall back to the native prompt rather than archiving unasked.
  if (choice === undefined) return window.confirm(question);
  const { confirmed, remember } = await choice;
  if (confirmed && remember) void persistClientSettingsPatch({ confirmWorldArchive: false });
  return confirmed;
}
