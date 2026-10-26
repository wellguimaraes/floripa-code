import { useEffect, useRef } from "react";

import { isConfirmDialogActive, requestConfirmDialog } from "../../confirmDialog";
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
 * Asks before archiving, in a popover beside `anchor` (the archive button, also for the
 * shortcut). A second shortcut press while it is open is ignored rather than queued.
 */
export async function confirmArchive(anchor: Element | null): Promise<boolean> {
  if (isConfirmDialogActive()) return false;
  return (
    (await requestConfirmDialog(
      "Archive this thread?\nYou can restore it from Settings → Archived.",
      { anchor },
    )) ??
    // No themed host is mounted; fall back to the native prompt rather than archiving unasked.
    window.confirm("Archive this thread?")
  );
}
