import { createContext, type ReactNode, useContext, useMemo } from "react";
import { Color, SRGBColorSpace } from "three";

import { useWorldHour } from "../worldTimeStore";
import { useRainAmount } from "../worldWeatherStore";
import { KeepColorContext, keepColors, SceneContrast } from "./contrast";
import { type Daylight, daylightAt, type Direction, lightDirection, overcast } from "./daylight";
import { palette } from "./palette";
import { Rain } from "./Rain";

/** True inside an island nobody is on any more: it shows in dark shades of the sea. */
export const FadedContext = createContext(false);

/** The darkest and lightest shade of the sea an empty island is drawn in. */
const SEA = new Color(palette.water).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
const DARKEST = 0.2;
const LIGHTEST = 0.5;
/** The sea's saturation kept, so the island blends into the water without glowing. */
const SATURATION = 0.7;
const fadedColors = new Map<string, string>();

/** A colour as it looks on an empty island: its own brightness as a shade of the sea. */
export function toFaded(color: string): string {
  let faded = fadedColors.get(color);
  if (faded === undefined) {
    const source = new Color(color);
    const grey = 0.2126 * source.r + 0.7152 * source.g + 0.0722 * source.b;
    const lightness = DARKEST + (LIGHTEST - DARKEST) * grey;
    faded = `#${new Color().setHSL(SEA.h, SEA.s * SATURATION, lightness, SRGBColorSpace).getHexString()}`;
    fadedColors.set(color, faded);
  }
  return faded;
}

/**
 * How much a surface glows in its own colour, on top of the light it gets:
 * characters glow a little at night, so their colours read in the dark.
 */
export const GlowContext = createContext(0);
/** Characters' glow at full night; it fades out toward day. Portraits never glow. */
const CHARACTER_GLOW = 0.4;

/** What the scene needs from the time of day, besides the lights themselves. */
export interface TimeOfDay {
  /** Toward the sun or moon; ground shadows fall away from it. */
  readonly light: Direction;
  /** After sunset: lamps rise and light up, the sign's spotlights come on. */
  readonly lampsOn: boolean;
  /** Characters' own glow (see `GlowContext`). */
  readonly glow: number;
  /** Ground shadows' opacity: fainter in dim light. */
  readonly shadowOpacity: number;
}

const NOON = 12.5;
export const TimeOfDayContext = createContext<TimeOfDay>({
  light: lightDirection(NOON),
  lampsOn: false,
  glow: 0,
  shadowOpacity: 0.16,
});

/** Steps for the glow and shadow, so dragging the time slider re-renders them only now and then. */
const step = (value: number, size: number) => Math.round(value / size) * size;

/** The world's lit surface material; in sea shades on an empty island, in full colour on a character. */
export function LitMaterial(props: {
  readonly color: string;
  readonly flatShading?: boolean;
  readonly side?: 0 | 1 | 2;
}) {
  const faded = useContext(FadedContext);
  const keepColor = useContext(KeepColorContext);
  const glow = useContext(GlowContext);
  const color = faded ? toFaded(props.color) : props.color;
  return (
    <meshLambertMaterial
      {...(keepColor ? { onUpdate: keepColors } : {})}
      color={color}
      emissive={glow > 0 ? color : "#000000"}
      emissiveIntensity={glow}
      flatShading={props.flatShading ?? false}
      side={props.side ?? 0}
    />
  );
}

/**
 * The world's light at the hour it shows (see `daylight.ts`), and the time of
 * day for everything inside. Only this re-renders as the hour moves; the
 * scene below re-renders when the context does, a few times an hour at most.
 */
export function WorldDaylight(props: { readonly children: ReactNode }) {
  const rain = useRainAmount();
  const clear = daylightAt(useWorldHour());
  const daylight = overcast(clear, rain);
  const glow = step(daylight.night * CHARACTER_GLOW, 0.05);
  // Fainter in dim light, and nearly gone under rain clouds.
  const shadowOpacity = step(
    0.16 * Math.min(1, Math.max(0.5, clear.keyIntensity / 1.6)) * (1 - 0.75 * rain),
    0.02,
  );
  const [x, y, z] = daylight.direction;
  const timeOfDay = useMemo<TimeOfDay>(
    () => ({ light: [x, y, z], lampsOn: daylight.lampsOn, glow, shadowOpacity }),
    [x, y, z, daylight.lampsOn, glow, shadowOpacity],
  );
  return (
    <TimeOfDayContext value={timeOfDay}>
      <SceneContrast sky={daylight.background} />
      <WorldLights daylight={daylight} />
      <Rain amount={rain} />
      {props.children}
    </TimeOfDayContext>
  );
}

/** The characters' glow at this time of day: their materials read it from `GlowContext`. */
export function CharacterGlow(props: { readonly children: ReactNode }) {
  return <GlowContext value={useContext(TimeOfDayContext).glow}>{props.children}</GlowContext>;
}

function WorldLights({ daylight }: { readonly daylight: Daylight }) {
  // Far off along the light's direction; a directional light only uses the direction.
  const [x, y, z] = daylight.direction;
  return (
    <>
      <hemisphereLight
        color={daylight.fillSky}
        groundColor={daylight.fillGround}
        intensity={daylight.fillIntensity}
      />
      <directionalLight
        position={[x * 20, y * 20, z * 20]}
        color={daylight.key}
        intensity={daylight.keyIntensity}
      />
    </>
  );
}
