import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSnoozePresets, snoozeWakeDescription } from "./Sidebar.snooze";

// Local-time constructor so preset math is timezone-stable in tests.
function localDate(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

const environmentId = EnvironmentId.make("environment-local");

describe("resolveSnoozePresets", () => {
  it("offers the default options in the morning, soonest first", () => {
    // Wednesday 2026-04-08 10:00 local.
    const presets = resolveSnoozePresets(localDate(2026, 4, 8, 10), "locale", environmentId);
    expect(presets.map((preset) => preset.id)).toEqual([
      "after:60",
      "after:180",
      "at:today:18:00",
      "at:tomorrow:09:00",
      "at:monday:09:00",
    ]);
    const threeHours = presets.find((preset) => preset.id === "after:180");
    expect(new Date(threeHours!.snoozedUntil).getHours()).toBe(13);
    const tomorrow = new Date(presets.find((p) => p.id === "at:tomorrow:09:00")!.snoozedUntil);
    expect(tomorrow.getDate()).toBe(9);
    expect(tomorrow.getHours()).toBe(9);
    const nextWeek = new Date(presets.find((p) => p.id === "at:monday:09:00")!.snoozedUntil);
    expect(nextWeek.getDay()).toBe(1);
    expect(nextWeek.getDate()).toBe(13);
  });

  it("drops the evening option once its time has passed", () => {
    expect(
      resolveSnoozePresets(localDate(2026, 4, 8, 21), "locale", environmentId).map(
        (preset) => preset.id,
      ),
    ).toEqual(["after:60", "after:180", "at:tomorrow:09:00", "at:monday:09:00"]);
  });

  it("formats preset times with the selected clock preference", () => {
    const twelveHour = resolveSnoozePresets(localDate(2026, 4, 8, 10), "12-hour", environmentId);
    const twentyFourHour = resolveSnoozePresets(
      localDate(2026, 4, 8, 10),
      "24-hour",
      environmentId,
    );

    expect(twelveHour.find((preset) => preset.id === "at:today:18:00")!.whenLabel).toMatch(/PM/i);
    expect(twentyFourHour.find((preset) => preset.id === "at:today:18:00")!.whenLabel).toBe(
      "18:00",
    );
  });
});

describe("snoozeWakeDescription", () => {
  const now = localDate(2026, 4, 8, 10);

  it("uses bare time today, 'tomorrow' next day, weekday within the week", () => {
    expect(
      snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "locale"),
    ).not.toContain("tomorrow");
    expect(snoozeWakeDescription(localDate(2026, 4, 9, 9).toISOString(), now, "locale")).toContain(
      "tomorrow",
    );
    expect(snoozeWakeDescription(localDate(2026, 4, 13, 9).toISOString(), now, "locale")).toMatch(
      /Mon/,
    );
  });

  it("formats wake descriptions with the selected clock preference", () => {
    expect(snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "12-hour")).toMatch(
      /PM/i,
    );
    expect(snoozeWakeDescription(localDate(2026, 4, 8, 18).toISOString(), now, "24-hour")).toBe(
      "18:00",
    );
  });
});
