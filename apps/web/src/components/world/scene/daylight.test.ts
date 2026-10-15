import { describe, expect, it } from "vite-plus/test";

import { daylightAt, lightDirection, overcast, SUNRISE, SUNSET } from "./daylight";
import { palette } from "./palette";

describe("daylightAt", () => {
  it("shows plain daylight at midday and moonlight at midnight", () => {
    expect(daylightAt(12).background.getHexString()).toBe(palette.daySky.slice(1));
    expect(daylightAt(12).lampsOn).toBe(false);
    expect(daylightAt(0).background.getHexString()).toBe(palette.nightSky.slice(1));
    expect(daylightAt(0).lampsOn).toBe(true);
  });

  it("keeps the lamps on from 30 minutes before sunset to 30 minutes after sunrise", () => {
    const minutes = (count: number) => count / 60;
    expect(daylightAt(SUNSET - minutes(31)).lampsOn).toBe(false);
    expect(daylightAt(SUNSET - minutes(30)).lampsOn).toBe(true);
    expect(daylightAt(SUNRISE + minutes(29)).lampsOn).toBe(true);
    expect(daylightAt(SUNRISE + minutes(31)).lampsOn).toBe(false);
  });

  it("warms the sun toward evening", () => {
    const evening = daylightAt(17.5).key;
    expect(evening.r).toBeGreaterThan(evening.b);
    const noon = daylightAt(12).key;
    expect(noon.r).toBeCloseTo(noon.b);
  });

  it("wraps hours past midnight", () => {
    expect(daylightAt(25).night).toBeCloseTo(daylightAt(1).night);
    expect(daylightAt(-1).night).toBeCloseTo(daylightAt(23).night);
  });
});

describe("lightDirection", () => {
  it("keeps the light above the horizon all day", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      expect(lightDirection(hour)[1]).toBeGreaterThan(0.3);
    }
  });

  it("swings the sun from the camera's left in the morning to its right in the evening", () => {
    // The camera's right is (1, 0, -1): positive x - z.
    const side = (hour: number) => {
      const [x, , z] = lightDirection(hour);
      return x - z;
    };
    expect(side(SUNRISE + 1)).toBeLessThan(0);
    expect(side(SUNSET - 1)).toBeGreaterThan(0);
  });

  it("moves in half-hour steps, so shadows are rebuilt only now and then", () => {
    expect(lightDirection(10.1)).toEqual(lightDirection(10));
    expect(lightDirection(10.3)).not.toEqual(lightDirection(10));
  });
});

describe("overcast", () => {
  it("leaves clear weather as it is", () => {
    const noon = daylightAt(12);
    expect(overcast(noon, 0)).toBe(noon);
  });

  it("softens the sun and greys the sky in full rain", () => {
    const evening = daylightAt(17.5);
    const rainy = overcast(evening, 1);
    expect(rainy.keyIntensity).toBeLessThan(evening.keyIntensity);
    expect(rainy.fillIntensity).toBeGreaterThan(evening.fillIntensity);
    const spread = (color: { r: number; g: number; b: number }) =>
      Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
    expect(spread(rainy.background)).toBeLessThan(spread(evening.background));
    expect(spread(rainy.key)).toBeLessThan(spread(evening.key));
  });
});
