import type { WorldDefinition } from "../definition/types";

/** How far the shoreline wanders off straight at `along` units down the screen. */
function coastWobble(along: number): number {
  return 0.7 * Math.sin(along / 7.3) + 0.45 * Math.sin(along / 3.1 + 1.7);
}
const COAST_WOBBLE_MAX = 1.15;
/** Water kept between a pier and the coast's sand. */
export const PIER_CLEARANCE = 1.2;
/** How far past a pier, up and down the screen, its bay eases back to the coast. */
const BAY_EASE = 7;

/**
 * How far the coast pulls back left of the shore by the island, in sand radii,
 * at points `along` sand radii down the screen from the island's middle. It
 * holds by the island, eases back above and below, and past the ends turns
 * away left (see `TURN`), so the mainland is a headland with sea round its ends.
 */
const OUTLINE: ReadonlyArray<readonly [along: number, back: number]> = [
  [-9.6, 1.28],
  [-9, 0.86],
  [-7.9, 0.58],
  [-6.2, 0.56],
  [-4.5, 0.35],
  [-3.4, 0.15],
  [-2.2, 0],
  [2.4, 0],
  [3.4, 0.16],
  [4.8, 0.22],
  [6.2, 0.16],
  [7.3, 0.3],
  [7.9, 0.86],
  [8.3, 1.28],
];
/** How sharply the shore keeps turning away past the outline's ends. */
const TURN = 0.5;

/** `OUTLINE` at `along`, smoothed between its points and curving on past its ends. */
function outlineBack(along: number): number {
  const slope = (index: number) => {
    const before = OUTLINE[Math.max(0, index - 1)]!;
    const after = OUTLINE[Math.min(OUTLINE.length - 1, index + 1)]!;
    return (after[1] - before[1]) / (after[0] - before[0]);
  };
  const first = OUTLINE[0]!;
  const last = OUTLINE[OUTLINE.length - 1]!;
  if (along <= first[0]) {
    const d = along - first[0];
    return first[1] + slope(0) * d + TURN * d * d;
  }
  if (along >= last[0]) {
    const d = along - last[0];
    return last[1] + slope(OUTLINE.length - 1) * d + TURN * d * d;
  }
  const index = OUTLINE.findIndex(([at]) => at > along) - 1;
  const [a0, b0] = OUTLINE[index]!;
  const [a1, b1] = OUTLINE[index + 1]!;
  const span = a1 - a0;
  const t = (along - a0) / span;
  // Cubic Hermite through the points, kept off the island's side of the shore.
  const h = (2 * t - 3) * t * t + 1;
  const back =
    h * b0 +
    (1 - h) * b1 +
    span * (t * (1 - t) * (1 - t) * slope(index) - t * t * (1 - t) * slope(index + 1));
  return Math.max(0, back);
}

/**
 * The mainland's shoreline down the screen, relative to the sand's middle:
 * through the lawn's left part, so the island reads as a cape whose lawn and
 * beach run on into the coast's, then round a bay wherever the pier lies, so
 * agents fishing there still sit over water. Away from the island it follows
 * `OUTLINE` and turns off to the left.
 */
export function mainlandShoreline(definition: WorldDefinition): (along: number) => number {
  // The camera looks down the (1, 1) diagonal, so (1, -1) is screen right and (1, 1) down.
  const screen = (x: number, z: number) => [(x - z) / Math.SQRT2, (x + z) / Math.SQRT2] as const;
  const sand = definition.terrain.find((patch) => patch.shape === "disc" && patch.kind === "sand");
  const lawn = definition.terrain.find((patch) => patch.shape === "disc" && patch.kind === "grass");
  const [sandX, sandZ] = sand?.center ?? [0, 0];
  const [, sandDown] = screen(sandX, sandZ);
  const lawnLeft =
    lawn?.shape === "disc"
      ? screen(lawn.center[0], lawn.center[1])[0] - lawn.radius * 0.45
      : screen(sandX, sandZ)[0];
  const base = lawnLeft + 2.6;
  const radius = sand?.shape === "disc" ? sand.radius : 1;
  const away = (along: number) => base + coastWobble(along) - radius * outlineBack(along / radius);
  // The pier's deck, sampled along its arc round the sand's middle.
  const deck = definition.props.flatMap((prop) => {
    if (prop.arc === undefined) return [];
    const { radius, width } = prop.arc;
    const angle = Math.atan2(prop.position[2] - sandZ, prop.position[0] - sandX);
    const reach = Math.max(prop.arc.left, prop.arc.right) / radius;
    return Array.from({ length: 13 }, (_, step) => angle - reach + (step / 6) * reach).flatMap(
      (at) =>
        [radius, radius + width].map((distance) => {
          const [right, down] = screen(
            sandX + distance * Math.cos(at),
            sandZ + distance * Math.sin(at),
          );
          return { right, along: down - sandDown };
        }),
    );
  });
  if (deck.length === 0) return away;
  const top = Math.min(...deck.map((point) => point.along)) - BAY_EASE;
  const bottom = Math.max(...deck.map((point) => point.along)) + BAY_EASE;
  const middle = (top + bottom) / 2;
  const halfSpan = (bottom - top) / 2;
  // A smooth dent, 1 in the middle and 0 at its ends.
  const dent = (along: number) => {
    const t = Math.min(1, Math.abs(along - middle) / halfSpan);
    return (Math.cos(Math.PI * t) + 1) / 2;
  };
  const depth = Math.max(
    0,
    ...deck.map(
      (point) =>
        (base + COAST_WOBBLE_MAX + PIER_CLEARANCE - point.right) /
        Math.max(dent(point.along), 0.05),
    ),
  );
  return (along) => away(along) - depth * dent(along);
}

/**
 * About how far a ground point, relative to the island's origin, lies seaward
 * of the mainland's sand: negative on the coast's land, as `MainlandCoast` lays it.
 */
export function mainlandOffshore(definition: WorldDefinition): (x: number, z: number) => number {
  const shoreline = mainlandShoreline(definition);
  const sand = definition.terrain.find((patch) => patch.shape === "disc" && patch.kind === "sand");
  const [sandX, sandZ] = sand?.center ?? [0, 0];
  const sandDown = (sandX + sandZ) / Math.SQRT2;
  return (x, z) => {
    const along = (x + z) / Math.SQRT2 - sandDown;
    // Straight out from the shore, not across it, where it turns away.
    const slope = shoreline(along + 0.5) - shoreline(along - 0.5);
    return ((x - z) / Math.SQRT2 - shoreline(along)) / Math.hypot(1, slope);
  };
}
