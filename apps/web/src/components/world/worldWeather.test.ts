import { describe, expect, it } from "vite-plus/test";

import { locationFromGeoJs, weatherFromOpenMeteo } from "./worldWeather";

const report = (weather_code: number, rain = 0, showers = 0) => ({
  current: { time: "2026-10-28T12:00", interval: 900, weather_code, rain, showers },
});

describe("weatherFromOpenMeteo", () => {
  it("reads clear, foggy and snowy skies as dry", () => {
    expect(weatherFromOpenMeteo(report(0))).toEqual({ raining: false, storm: false });
    expect(weatherFromOpenMeteo(report(45))).toEqual({ raining: false, storm: false });
    expect(weatherFromOpenMeteo(report(73))).toEqual({ raining: false, storm: false });
  });

  it("reads drizzle, rain and showers as rain", () => {
    for (const code of [51, 63, 66, 81]) {
      expect(weatherFromOpenMeteo(report(code))).toEqual({ raining: true, storm: false });
    }
  });

  it("reads thunder as a storm with rain", () => {
    expect(weatherFromOpenMeteo(report(95))).toEqual({ raining: true, storm: true });
    expect(weatherFromOpenMeteo(report(99))).toEqual({ raining: true, storm: true });
  });

  it("counts measurable rain even when the condition says cloudy", () => {
    expect(weatherFromOpenMeteo(report(3, 0.2))?.raining).toBe(true);
    expect(weatherFromOpenMeteo(report(3, 0, 0.1))?.raining).toBe(true);
    expect(weatherFromOpenMeteo(report(3, 0.05))?.raining).toBe(false);
  });

  it("gives up on a report it can't read", () => {
    expect(weatherFromOpenMeteo(null)).toBeNull();
    expect(weatherFromOpenMeteo({})).toBeNull();
    expect(weatherFromOpenMeteo({ current: { weather_code: "?" } })).toBeNull();
  });
});

describe("locationFromGeoJs", () => {
  it("reads GeoJS's string coordinates", () => {
    expect(locationFromGeoJs({ latitude: "-27.6168", longitude: "-48.4997" })).toEqual({
      latitude: -27.6168,
      longitude: -48.4997,
    });
  });

  it("gives up on missing or unreadable coordinates", () => {
    expect(locationFromGeoJs(null)).toBeNull();
    expect(locationFromGeoJs({ latitude: "", longitude: "" })).toBeNull();
    expect(locationFromGeoJs({ latitude: "north", longitude: "1" })).toBeNull();
  });
});
