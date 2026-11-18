/** A box on screen, in pixels from the canvas's top left corner. */
export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type BubbleSide = "above" | "right" | "left" | "below";

/** Tried in this order when they leave the same room: above reads as the character speaking. */
const SIDES: ReadonlyArray<BubbleSide> = ["above", "right", "left", "below"];

interface BesideInput {
  /** What the bubble keeps clear of: a character, or the whole path of one walking. */
  readonly avoid: ScreenRect;
  readonly size: { readonly width: number; readonly height: number };
  /** Where the bubble may go. */
  readonly area: ScreenRect;
  /** Room between the bubble and `avoid`. */
  readonly gap: number;
}

/**
 * Where a bubble goes so it does not cover `avoid`. Keeps `previous` while it still fits, so the
 * bubble does not hop between sides as the map moves; else the side that fits with the most room
 * to spare. Null when no side fits.
 */
export function placeBeside(
  input: BesideInput & { readonly previous: BubbleSide | null },
): { readonly side: BubbleSide; readonly left: number; readonly top: number } | null {
  const { previous } = input;
  const side =
    previous !== null && spareRoom(previous, input) >= 0 ? previous : roomiestSide(input);
  return spareRoom(side, input) >= 0 ? { side, ...placeOn(side, input) } : null;
}

/** The side with the most room to spare for the bubble, or the least missing when none fits. */
export function roomiestSide(input: BesideInput): BubbleSide {
  let best = SIDES[0]!;
  for (const side of SIDES) if (spareRoom(side, input) > spareRoom(best, input)) best = side;
  return best;
}

/**
 * The bubble on `side` of `avoid`, centred along it. Kept inside `area`, sliding as little as it
 * takes; a side without the room puts it over `avoid` rather than out of the area.
 */
export function placeOn(
  side: BubbleSide,
  input: BesideInput,
): { readonly left: number; readonly top: number } {
  const { avoid, area, gap } = input;
  const { width, height } = input.size;
  const clamp = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), Math.max(low, high));
  const left = (value: number) => clamp(value, area.left, area.right - width);
  const top = (value: number) => clamp(value, area.top, area.bottom - height);
  const centredLeft = left((avoid.left + avoid.right - width) / 2);
  const centredTop = top((avoid.top + avoid.bottom - height) / 2);
  switch (side) {
    case "above":
      return { left: centredLeft, top: top(avoid.top - gap - height) };
    case "below":
      return { left: centredLeft, top: top(avoid.bottom + gap) };
    case "right":
      return { left: left(avoid.right + gap), top: centredTop };
    case "left":
      return { left: left(avoid.left - gap - width), top: centredTop };
  }
}

/** Pixels left over beside `avoid` on `side` once the bubble is there; negative when it lacks room. */
function spareRoom(side: BubbleSide, input: BesideInput): number {
  const { avoid, area, gap } = input;
  const { width, height } = input.size;
  if (width > area.right - area.left || height > area.bottom - area.top) return -Infinity;
  switch (side) {
    case "above":
      return avoid.top - gap - height - area.top;
    case "below":
      return area.bottom - avoid.bottom - gap - height;
    case "right":
      return area.right - avoid.right - gap - width;
    case "left":
      return avoid.left - gap - width - area.left;
  }
}
