import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems } from "../threadActionMenu.logic";
import { worldThreadActionMenuItems } from "./worldThreadActionMenu";

describe("worldThreadActionMenuItems", () => {
  it("keeps archive and drops the sidebar shelf actions", () => {
    const items = worldThreadActionMenuItems(
      buildThreadActionMenuItems({
        canOperate: true,
        branch: null,
        projectFilter: null,
        isPinned: false,
        isSettled: false,
        autoSettleEnabled: true,
        isSnoozed: false,
        canSnoozeNow: true,
        isRegeneratingTitle: false,
        supports: {
          settlement: true,
          autoSettleOptOut: true,
          snooze: true,
          pinning: true,
          titleRegeneration: true,
        },
        snoozePresets: [],
      }),
    );

    expect(items.map((item) => item.label)).toEqual([
      "Rename thread",
      "Regenerate title",
      "Auto-archive behavior",
      "Copy",
      "Project settings",
      "Archive thread",
      "Delete",
    ]);
    expect(items[0]?.separatorBefore).toBe(false);
  });
});
