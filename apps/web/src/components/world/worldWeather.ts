/**
 * Live weather for the world's auto mode, from wttr.in: it places this
 * computer by its IP address, so no location is asked for or sent.
 */

export interface Weather {
  readonly raining: boolean;
  readonly storm: boolean;
}

export const WEATHER_URL = "https://wttr.in/?format=j1";
/** How often auto mode checks the weather. */
export const WEATHER_POLL_MS = 15 * 60_000;

// World Weather Online condition codes, as wttr.in reports them.
/** Thunder, with or without rain. */
const THUNDER = new Set([200, 386, 389, 392, 395]);
/** Drizzle, rain, showers, and sleet; snow is left out, the world has none. */
const RAIN = new Set([
  176, 182, 185, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 317, 320, 353, 356,
  359, 362, 365,
]);
/** Rain gauge readings below this are a passing drop or two, not rain. */
const MIN_PRECIP_MM = 0.2;

/** The weather from wttr.in's `j1` report, or null when it can't be read. */
export function weatherFromWttr(report: unknown): Weather | null {
  const current = (report as { current_condition?: unknown })?.current_condition;
  if (!Array.isArray(current) || current.length === 0) return null;
  const condition = current[0] as { weatherCode?: unknown; precipMM?: unknown };
  const code = Number(condition.weatherCode);
  if (!Number.isFinite(code)) return null;
  const precip = Number(condition.precipMM);
  const storm = THUNDER.has(code);
  const raining = storm || RAIN.has(code) || (Number.isFinite(precip) && precip >= MIN_PRECIP_MM);
  return { raining, storm };
}

export async function fetchWeather(signal: AbortSignal): Promise<Weather | null> {
  const response = await fetch(WEATHER_URL, { signal });
  if (!response.ok) return null;
  return weatherFromWttr(await response.json());
}
