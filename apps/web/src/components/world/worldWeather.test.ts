import { describe, expect, it } from "vite-plus/test";

import { weatherFromWttr } from "./worldWeather";

const report = (weatherCode: string, precipMM = "0.0") => ({
  current_condition: [{ weatherCode, precipMM }],
});

describe("weatherFromWttr", () => {
  it("reads clear, misty and snowy skies as dry", () => {
    expect(weatherFromWttr(report("113"))).toEqual({ raining: false, storm: false });
    expect(weatherFromWttr(report("143"))).toEqual({ raining: false, storm: false });
    expect(weatherFromWttr(report("338"))).toEqual({ raining: false, storm: false });
  });

  it("reads drizzle, rain and showers as rain", () => {
    for (const code of ["266", "296", "308", "353"]) {
      expect(weatherFromWttr(report(code))).toEqual({ raining: true, storm: false });
    }
  });

  it("reads thunder as a storm with rain", () => {
    expect(weatherFromWttr(report("389"))).toEqual({ raining: true, storm: true });
    expect(weatherFromWttr(report("200"))).toEqual({ raining: true, storm: true });
  });

  it("counts measurable rain even when the condition says cloudy", () => {
    expect(weatherFromWttr(report("119", "0.4"))?.raining).toBe(true);
    expect(weatherFromWttr(report("119", "0.1"))?.raining).toBe(false);
  });

  it("gives up on a report it can't read", () => {
    expect(weatherFromWttr(null)).toBeNull();
    expect(weatherFromWttr({})).toBeNull();
    expect(weatherFromWttr({ current_condition: [{ weatherCode: "?" }] })).toBeNull();
  });
});
