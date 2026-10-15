import type { FixedArea, PropKind, WorldDefinition, WorldProp } from "../definition/types";
import { hashString, seededRandom } from "./hash";

/** How far a palm may stand from its spot, along each axis. */
const PALM_SHIFT = 0.5;
/** How far a palm's lean may turn from its spot's. */
const PALM_TURN = 0.8;
/** How far a tree or shore rock may stand from its spot, along each axis. */
const NUDGE = 0.25;
/** A shift never brings a prop nearer a character's spot than this, or than it already stood. */
const CLEARANCE = 1;
/** How small a shore rock or tree left out of an island's big ones is. */
const SMALL: Partial<Record<PropKind, number>> = { boulder: 0.45, tree: 0.6, sibipiruna: 0.6 };

const isTree = (prop: WorldProp) => prop.kind === "tree" || prop.kind === "sibipiruna";
const varies = (prop: WorldProp) => prop.kind === "palm" || prop.kind === "boulder" || isTree(prop);

const variants = new WeakMap<WorldDefinition, Map<string, WorldDefinition>>();

/**
 * The island `definition` as the project `islandKey` has it, so islands of
 * the same size differ: palms stand a little apart and lean their own way,
 * trees and shore rocks shift a touch, only some of each are big (one, two
 * or all), each tree spot is a round tree or a sibipiruna, and every prop
 * takes its look from the island's own `seed`. Everything
 * reads the varied props, so paths, scenery and shadows follow them. The
 * same project always gets the same island.
 */
export function islandVariant(definition: WorldDefinition, islandKey: string): WorldDefinition {
  if (!definition.props.some(varies)) return definition;
  let byKey = variants.get(definition);
  if (byKey === undefined) {
    byKey = new Map();
    variants.set(definition, byKey);
  }
  const cached = byKey.get(islandKey);
  if (cached !== undefined) return cached;
  const random = seededRandom(hashString(`variant:${islandKey}`));
  const slots = Object.values(definition.areas)
    .filter((area): area is FixedArea => area.kind === "fixed")
    .flatMap((area) => [...area.slots, ...(area.spillover ?? [])]);
  const sand = definition.terrain.find((patch) => patch.shape === "disc" && patch.kind === "sand");
  /** How far out from the sand's middle, so a shift can't carry a palm into the sea. */
  const outward = (x: number, z: number) =>
    sand === undefined ? 0 : Math.hypot(x - sand.center[0], z - sand.center[1]);
  const nearestSlot = (x: number, z: number) =>
    Math.min(...slots.map((slot) => Math.hypot(x - slot.position[0], z - slot.position[2])));
  const small = new Set([
    ...leftSmall(definition.props, (prop) => prop.kind === "boulder", random),
    ...leftSmall(definition.props, isTree, random),
  ]);
  const props = definition.props.map((prop): WorldProp => {
    if (!varies(prop)) return prop;
    const [x, y, z] = prop.position;
    const shift = prop.kind === "palm" ? PALM_SHIFT : NUDGE;
    const shifted = [x + (random() * 2 - 1) * shift, y, z + (random() * 2 - 1) * shift] as const;
    const roomy =
      nearestSlot(shifted[0], shifted[2]) >= Math.min(CLEARANCE, nearestSlot(x, z)) &&
      (prop.kind !== "palm" || outward(shifted[0], shifted[2]) <= outward(x, z) + 0.15);
    const position = roomy ? shifted : prop.position;
    const facing =
      prop.kind === "palm" ? prop.facing + (random() * 2 - 1) * PALM_TURN : prop.facing;
    const kind = isTree(prop) ? (random() < 0.5 ? "tree" : "sibipiruna") : prop.kind;
    const scale = small.has(prop) ? SMALL[kind] : prop.scale;
    return { ...prop, kind, position, facing, ...(scale === undefined ? {} : { scale }) };
  });
  const variant = { ...definition, seed: hashString(islandKey), props };
  byKey.set(islandKey, variant);
  return variant;
}

/** Of the props `matching`, one up to all stay big; returns the rest. */
function leftSmall(
  props: ReadonlyArray<WorldProp>,
  matching: (prop: WorldProp) => boolean,
  random: () => number,
): ReadonlyArray<WorldProp> {
  const group = props.filter(matching);
  if (group.length === 0) return [];
  const big = 1 + Math.floor(random() * group.length);
  const first = Math.floor(random() * group.length);
  return group.filter((_, index) => (index - first + group.length) % group.length >= big);
}
