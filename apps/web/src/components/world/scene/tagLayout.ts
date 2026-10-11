export interface ScreenPoint {
  readonly key: string;
  readonly x: number;
  readonly y: number;
}

const TAG_GAP = 2;

/**
 * Lifts tags that would overlap: lowest on screen first, each one moves up
 * past any tag already placed until it sits clear. Tags are a few dozen at
 * most and this runs only while an island is hovered.
 */
export function layoutTags(
  points: ReadonlyArray<ScreenPoint>,
  sizes: ReadonlyMap<string, { readonly width: number; readonly height: number }>,
): Map<string, number> {
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const lifted = new Map<string, number>();
  for (const point of points.toSorted((a, b) => b.y - a.y)) {
    const size = sizes.get(point.key);
    if (size === undefined) continue;
    const left = point.x - size.width / 2;
    const right = point.x + size.width / 2;
    let bottom = point.y;
    for (let moved = true; moved;) {
      moved = false;
      for (const box of placed) {
        const overlaps =
          left < box.right &&
          right > box.left &&
          bottom > box.top &&
          bottom - size.height < box.bottom;
        if (overlaps) {
          bottom = box.top - TAG_GAP;
          moved = true;
        }
      }
    }
    placed.push({ left, right, top: bottom - size.height, bottom });
    lifted.set(point.key, bottom);
  }
  return lifted;
}
