import { createContext, useContext } from "react";
import { Color, SRGBColorSpace } from "three";
import { KeepColorContext, keepColors } from "./contrast";
import { palette } from "./palette";

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

/** The world's lit surface material; in sea shades on an empty island, in full colour on a character. */
export function LitMaterial(props: {
  readonly color: string;
  readonly flatShading?: boolean;
  readonly side?: 0 | 1 | 2;
}) {
  const faded = useContext(FadedContext);
  const keepColor = useContext(KeepColorContext);
  return (
    <meshLambertMaterial
      {...(keepColor ? { onUpdate: keepColors } : {})}
      color={faded ? toFaded(props.color) : props.color}
      flatShading={props.flatShading ?? false}
      side={props.side ?? 0}
    />
  );
}
