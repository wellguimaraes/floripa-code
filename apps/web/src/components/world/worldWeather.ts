/**
 * Live weather for the world's auto mode, from Open-Meteo. GeoJS places this
 * computer by its IP address first, so no location is asked for.
 */

export interface Weather {
  readonly raining: boolean;
  readonly storm: boolean;
}

export const LOCATION_URL = "https://get.geojs.io/v1/ip/geo.json";
export const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
/** How often auto mode checks the weather. */
export const WEATHER_POLL_MS = 15 * 60_000;

// WMO weather interpretation codes, as Open-Meteo reports them.
/** Thunder, with or without hail. */
const THUNDER = new Set([95, 96, 99]);
/** Drizzle, rain, and showers, freezing or not; snow is left out, the world has none. */
const RAIN = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);
/** Rain over the last 15 minutes below this is a passing drop or two, not rain. */
const MIN_RAIN_MM = 0.1;

/** The latitude and longitude from GeoJS's IP lookup, or null when it can't be read. */
export function locationFromGeoJs(
  report: unknown,
): { readonly latitude: number; readonly longitude: number } | null {
  const { latitude, longitude } = (report ?? {}) as { latitude?: unknown; longitude?: unknown };
  // GeoJS sends coordinates as strings; an empty one would read as 0.
  if (latitude == null || longitude == null || latitude === "" || longitude === "") return null;
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { latitude: lat, longitude: lon };
}

/** The weather from Open-Meteo's `current` report, or null when it can't be read. */
export function weatherFromOpenMeteo(report: unknown): Weather | null {
  const current = (report as { current?: unknown } | null)?.current;
  if (typeof current !== "object" || current === null) return null;
  const { weather_code, rain, showers } = current as {
    weather_code?: unknown;
    rain?: unknown;
    showers?: unknown;
  };
  if (typeof weather_code !== "number") return null;
  const fallen =
    (typeof rain === "number" ? rain : 0) + (typeof showers === "number" ? showers : 0);
  const storm = THUNDER.has(weather_code);
  const raining = storm || RAIN.has(weather_code) || fallen >= MIN_RAIN_MM;
  return { raining, storm };
}

export async function fetchWeather(signal: AbortSignal): Promise<Weather | null> {
  const located = await fetch(LOCATION_URL, { signal });
  if (!located.ok) return null;
  const location = locationFromGeoJs(await located.json());
  if (location === null) return null;
  const url = new URL(WEATHER_URL);
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("current", "weather_code,rain,showers");
  const response = await fetch(url, { signal });
  if (!response.ok) return null;
  return weatherFromOpenMeteo(await response.json());
}
