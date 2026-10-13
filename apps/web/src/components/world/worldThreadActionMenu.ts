import type { ContextMenuItem } from "@t3tools/contracts";

import type { ThreadActionMenuId } from "../threadActionMenu.logic";

/** Sidebar-shelf actions the world has no place for: no pinned, snoozed or unread lists. */
const WORLD_HIDDEN_ACTIONS: ReadonlySet<ThreadActionMenuId> = new Set([
  "pin",
  "unpin",
  "settle",
  "unsettle",
  "snooze",
  "unsnooze",
  "mark-unread",
]);

/**
 * The chat header's thread menu as the world shows it. The world speaks of archiving only,
 * so the auto-settle setting reads as auto-archive.
 */
export function worldThreadActionMenuItems(
  items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  return (
    items
      .filter((item) => !WORLD_HIDDEN_ACTIONS.has(item.id))
      .map((item) =>
        item.id === "auto-settle" ? { ...item, label: "Auto-archive behavior" } : item,
      )
      // With the lifecycle group gone, the menu can open on what was its second group.
      .map((item, index) => (index === 0 ? { ...item, separatorBefore: false } : item))
  );
}
