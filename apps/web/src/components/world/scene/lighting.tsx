import { createContext, useContext } from "react";
import { Color } from "three";

/** True inside an island nobody is on any more: it shows, in washed-out grey. */
export const FadedContext = createContext(false);

/** How far toward white a faded grey is lifted, so the island reads as washed out. */
const LIFT = 0.3;
const fadedColors = new Map<string, string>();

/** A colour as it looks on an empty island: its own brightness in grey, lightened. */
export function toFaded(color: string): string {
  let faded = fadedColors.get(color);
  if (faded === undefined) {
    const source = new Color(color);
    const grey = 0.2126 * source.r + 0.7152 * source.g + 0.0722 * source.b;
    faded = `#${new Color(grey, grey, grey).lerp(new Color(1, 1, 1), LIFT).getHexString()}`;
    fadedColors.set(color, faded);
  }
  return faded;
}

/** The world's lit surface material; washed out on an empty island. */
export function LitMaterial(props: {
  readonly color: string;
  readonly flatShading?: boolean;
  readonly side?: 0 | 1 | 2;
}) {
  const faded = useContext(FadedContext);
  return (
    <meshLambertMaterial
      color={faded ? toFaded(props.color) : props.color}
      flatShading={props.flatShading ?? false}
      side={props.side ?? 0}
    />
  );
}
