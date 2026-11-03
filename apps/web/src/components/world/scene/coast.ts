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
 * The mainland's shoreline down the screen, relative to the sand's middle:
 * through the lawn's left part, so the island reads as a cape whose lawn and
 * beach run on into the coast's, then round a bay wherever the pier lies, so
 * agents fishing there still sit over water.
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
  if (deck.length === 0) return (along) => base + coastWobble(along);
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
  return (along) => base + coastWobble(along) - depth * dent(along);
}
