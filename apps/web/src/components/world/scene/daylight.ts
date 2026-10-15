import { Color, MathUtils } from "three";

import { palette } from "./palette";

/**
 * The world's light through the day, from the hour (0 to 24, local time): a
 * warm dusk-lit night, a golden sunrise, plain daylight, a golden afternoon, a red
 * sunset, and night again. Pure, so the scene and the tests read the same day.
 */

export type Direction = readonly [x: number, y: number, z: number];

/** One moment's look; the day blends between these. */
interface Keyframe {
  readonly hour: number;
  /** The sun's (or moon's) colour and strength. */
  readonly key: string;
  readonly keyIntensity: number;
  /** The hemisphere fill: from the sky above, and bounced off the ground below. */
  readonly fillSky: string;
  readonly fillGround: string;
  readonly fillIntensity: number;
  /** The sky behind the world. */
  readonly background: string;
  /** 0 by day, 1 at night: how much the lamps and the characters' glow are needed. */
  readonly night: number;
}

/**
 * Night keeps early dusk's light, a dim warm glow just past sunset, rather
 * than going cold and blue; only the sky goes dark.
 */
const NIGHT = {
  key: "#f3857f",
  keyIntensity: 1.2,
  fillSky: "#867fc3",
  fillGround: "#38395d",
  fillIntensity: 1.4,
  background: palette.nightSky,
  night: 1,
} as const;

const DAY = {
  key: "#ffffff",
  keyIntensity: 1.6,
  fillSky: "#ffffff",
  fillGround: palette.groundLight,
  fillIntensity: 1.7,
  background: palette.daySky,
  night: 0,
} as const;

const KEYFRAMES: ReadonlyArray<Keyframe> = [
  { hour: 0, ...NIGHT },
  { hour: 5, ...NIGHT },
  // Sunrise: a dim pink-orange sun under a violet sky.
  {
    hour: 6,
    key: "#ff9a6b",
    keyIntensity: 0.9,
    fillSky: "#9a8fc8",
    fillGround: "#4a4a6a",
    fillIntensity: 1.4,
    background: "#e9a38f",
    night: 0.4,
  },
  // Golden morning.
  {
    hour: 7.5,
    key: "#ffc27a",
    keyIntensity: 2.2,
    fillSky: "#c9d3f0",
    fillGround: palette.groundLight,
    fillIntensity: 1.4,
    background: "#f6d2a8",
    night: 0,
  },
  { hour: 9.5, ...DAY },
  { hour: 15.5, ...DAY },
  // Golden afternoon: a low, warm sun, cool blue sky light in the shade.
  {
    hour: 17.5,
    key: "#ffb26b",
    keyIntensity: 2,
    fillSky: "#9fbbe6",
    fillGround: palette.groundLight,
    fillIntensity: 1.5,
    background: "#f7c9a0",
    night: 0,
  },
  // Sunset: a dim red sun going down.
  {
    hour: 18.75,
    key: "#ff7a4a",
    keyIntensity: 1.35,
    fillSky: "#8a7fc0",
    fillGround: "#3a3a5e",
    fillIntensity: 1.45,
    background: "#d9776a",
    night: 0.4,
  },
  { hour: 19.75, ...NIGHT },
  { hour: 24, ...NIGHT },
];

/** The sun is up from sunrise to sunset; the rest of the time the moon lights the world. */
export const SUNRISE = 6;
export const SUNSET = 19;
/** Lamps come on this long before sunset and stay on until this long after sunrise. */
const LAMP_MARGIN_HOURS = 30 / 60;
/** The moon stays put, high and a little left of the camera. */
const MOON: Direction = normalize([7, 12, 6]);
/** Light and shadows move in steps this long, so shadows are rebuilt only a few times an hour. */
const SUN_STEP_HOURS = 0.5;
/** Kept off the horizon, so shadows never stretch across the whole island. */
const LOWEST_SUN = MathUtils.degToRad(18);
const HIGHEST_SUN = MathUtils.degToRad(58);
/** How far the sun swings either side of straight behind the camera. */
const SUN_SWING = MathUtils.degToRad(75);

export interface Daylight {
  /** Toward the sun or moon, as a unit vector. Moves in steps (see `SUN_STEP_HOURS`). */
  readonly direction: Direction;
  readonly key: Color;
  readonly keyIntensity: number;
  readonly fillSky: Color;
  readonly fillGround: Color;
  readonly fillIntensity: number;
  readonly background: Color;
  /** 0 by day, 1 at night. */
  readonly night: number;
  readonly lampsOn: boolean;
}

export function daylightAt(hour: number): Daylight {
  const at = wrapHour(hour);
  const index = KEYFRAMES.findIndex((frame) => frame.hour > at);
  const next = KEYFRAMES[index === -1 ? KEYFRAMES.length - 1 : index]!;
  const previous = KEYFRAMES[index <= 0 ? 0 : index - 1]!;
  const span = next.hour - previous.hour;
  // Eased, so each stretch of the day settles into its look rather than sliding through it.
  const t = span === 0 ? 0 : MathUtils.smoothstep(at, previous.hour, next.hour);
  const color = (from: string, to: string) => new Color(from).lerp(new Color(to), t);
  const night = MathUtils.lerp(previous.night, next.night, t);
  return {
    direction: lightDirection(at),
    key: color(previous.key, next.key),
    keyIntensity: MathUtils.lerp(previous.keyIntensity, next.keyIntensity, t),
    fillSky: color(previous.fillSky, next.fillSky),
    fillGround: color(previous.fillGround, next.fillGround),
    fillIntensity: MathUtils.lerp(previous.fillIntensity, next.fillIntensity, t),
    background: color(previous.background, next.background),
    night,
    lampsOn: at >= SUNSET - LAMP_MARGIN_HOURS || at < SUNRISE + LAMP_MARGIN_HOURS,
  };
}

/**
 * `daylight` under rain clouds, `amount` of the way (0 clear, 1 full rain):
 * the sun softens behind them and the brighter sky light makes up most of
 * it, so the world stays about as bright; colours wash out toward grey, and
 * the sky greys over.
 */
export function overcast(daylight: Daylight, amount: number): Daylight {
  if (amount <= 0) return daylight;
  const grey = (color: Color, washOut: number, darken = 0) => {
    const level = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    return color
      .clone()
      .lerp(new Color(level, level, level), washOut * amount)
      .multiplyScalar(1 - darken * amount);
  };
  return {
    ...daylight,
    key: grey(daylight.key, 0.6),
    keyIntensity: daylight.keyIntensity * (1 - 0.45 * amount),
    fillSky: grey(daylight.fillSky, 0.5),
    fillGround: grey(daylight.fillGround, 0.4),
    fillIntensity: daylight.fillIntensity * (1 + 0.2 * amount),
    background: grey(daylight.background, 0.7, 0.08),
  };
}

/**
 * Toward the light at this hour. By day the sun arcs from the camera's left at
 * sunrise, over behind the camera at midday, to its right at sunset, so the
 * island stays lit from the front; at night, the moon.
 */
export function lightDirection(hour: number): Direction {
  const at = Math.round(wrapHour(hour) / SUN_STEP_HOURS) * SUN_STEP_HOURS;
  if (at < SUNRISE || at > SUNSET) return MOON;
  const progress = (at - SUNRISE) / (SUNSET - SUNRISE);
  const swing = MathUtils.lerp(-SUN_SWING, SUN_SWING, progress);
  const height = LOWEST_SUN + (HIGHEST_SUN - LOWEST_SUN) * Math.sin(Math.PI * progress);
  // The camera looks from +x/+z: "behind the camera" is (1, 0, 1), its right is (1, 0, -1).
  const toward = Math.cos(swing);
  const right = Math.sin(swing);
  const flat = Math.cos(height);
  return normalize([
    (flat * (toward + right)) / Math.SQRT2,
    Math.sin(height),
    (flat * (toward - right)) / Math.SQRT2,
  ]);
}

/** The hour now, in this browser's time zone. */
export function localHour(now: Date = new Date()): number {
  return now.getHours() + now.getMinutes() / 60;
}

function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

function normalize([x, y, z]: Direction): Direction {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}
