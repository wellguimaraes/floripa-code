import { createContext, useContext } from "react";
import { Color } from "three";

import { palette } from "./palette";

/** True inside an island where night has fallen. */
export const NightContext = createContext(false);

const NIGHT_MIX = 0.6;
const NIGHT_DIM = 0.48;
const nightColors = new Map<string, string>();

/** A colour as it looks at night: pulled toward deep blue and dimmed. */
function toNight(color: string): string {
  let night = nightColors.get(color);
  if (night === undefined) {
    night = `#${new Color(color)
      .lerp(new Color(palette.night), NIGHT_MIX)
      .multiplyScalar(NIGHT_DIM)
      .getHexString()}`;
    nightColors.set(color, night);
  }
  return night;
}

/**
 * The world's lit surface material. It darkens on islands where night has
 * fallen, so each island keeps its own time of day under the shared sky.
 */
export function LitMaterial(props: {
  readonly color: string;
  readonly flatShading?: boolean;
  readonly side?: 0 | 1 | 2;
}) {
  const night = useContext(NightContext);
  return (
    <meshLambertMaterial
      color={night ? toNight(props.color) : props.color}
      flatShading={props.flatShading ?? false}
      side={props.side ?? 0}
    />
  );
}
