import type {
  PropKind,
  SceneryKind,
  TerrainKind,
  TerrainPatch,
  Vec3,
  WorldDefinition,
  WorldProp,
} from "../definition/types";
import { seededRandom } from "./hash";

/**
 * Each scenery kind at scale 1: how tall it stands and how much ground it
 * takes. Characters walk through grass, so it may grow on roads.
 */
export const SCENERY_SIZE: Record<
  SceneryKind,
  { readonly height: number; readonly radius: number; readonly walkThrough?: boolean }
> = {
  rock: { height: 0.3, radius: 0.3 },
  grass: { height: 0.3, radius: 0.25, walkThrough: true },
};

export const isScenery = (kind: PropKind): kind is SceneryKind => kind in SCENERY_SIZE;

/** Which ground shows where patches overlap: the higher layer. */
const LAYER: Record<TerrainKind, number> = { sand: 0, grass: 1, path: 2 };
/** The camera looks down from +x/+z (see `CAMERA_OFFSET` in WorldCanvas)... */
const TOWARD_CAMERA = [Math.SQRT1_2, Math.SQRT1_2] as const;
/** ...from this high: a thing `h` tall hides what stands up to `h * VIEW_REACH` behind it. */
const VIEW_REACH = Math.hypot(18, 18) / 20;
/** Half a character's width, kept in view. */
const BODY = 0.4;
/** Room around a character's spot: someone stands, sits or lies there. */
const SPOT = 0.7;
/** Half a road's width. */
const ROAD = 0.7;
const ATTEMPTS_PER_ITEM = 200;

interface Keepout {
  readonly from: readonly [x: number, z: number];
  readonly to: readonly [x: number, z: number];
  readonly radius: number;
}

const cache = new WeakMap<WorldDefinition, ReadonlyArray<WorldProp>>();

/**
 * The definition's scenery rules, placed: the same props for the same
 * definition every time, on every client. Nothing lands on a spot, road, prop
 * or the sign, and nothing tall stands between the camera and a spot.
 */
export function islandScenery(definition: WorldDefinition): ReadonlyArray<WorldProp> {
  const cached = cache.get(definition);
  if (cached !== undefined) return cached;
  const random = seededRandom(0x5eed);
  const slots = slotSpots(definition);
  const keepouts = [...spotKeepouts(definition, slots), ...layoutKeepouts(definition)];
  const { nodes, edges } = definition.roads;
  const roads = edges.map(([from, to]) => segment(nodes[from]!, nodes[to]!, ROAD));
  const placed: { readonly x: number; readonly z: number; readonly radius: number }[] = [];
  const props: WorldProp[] = [];

  for (const rule of definition.scenery ?? []) {
    const grounds = definition.terrain.filter((patch) => patch.kind === rule.on);
    if (grounds.length === 0) continue;
    let count = 0;
    for (let attempt = 0; attempt < rule.count * ATTEMPTS_PER_ITEM; attempt += 1) {
      if (count === rule.count) break;
      const [x, z] = pointIn(
        rule.near === undefined
          ? grounds[Math.floor(random() * grounds.length)]!
          : { shape: "disc", kind: rule.on, ...rule.near },
        random,
      );
      const scale = rule.scale[0] + random() * (rule.scale[1] - rule.scale[0]);
      const facing = random() * Math.PI * 2;
      const { height, radius: base, walkThrough = false } = SCENERY_SIZE[rule.kind];
      const radius = base * scale;
      if (!grounds.some((ground) => edgeDistance(ground, x, z) >= radius)) continue;
      if (covered(definition.terrain, rule.on, x, z, radius)) continue;
      const blocks = (keepout: Keepout) => segmentDistance(x, z, keepout) < keepout.radius + radius;
      if (keepouts.some(blocks) || (!walkThrough && roads.some(blocks))) continue;
      if (placed.some((other) => Math.hypot(x - other.x, z - other.z) < other.radius + radius)) {
        continue;
      }
      if (slots.some((spot) => hides(x, z, radius, height * scale, spot))) continue;
      placed.push({ x, z, radius });
      props.push({ kind: rule.kind, position: [x, 0, z], facing, scale });
      count += 1;
    }
  }
  cache.set(definition, props);
  return props;
}

/** Whether a thing at x/z, `height` tall, stands between the camera and someone at `spot`. */
function hides(x: number, z: number, radius: number, height: number, spot: Vec3): boolean {
  const dx = x - spot[0];
  const dz = z - spot[2];
  const ahead = dx * TOWARD_CAMERA[0] + dz * TOWARD_CAMERA[1];
  const aside = Math.abs(dx * TOWARD_CAMERA[1] - dz * TOWARD_CAMERA[0]);
  return ahead > -radius && ahead < height * VIEW_REACH + radius && aside < radius + BODY;
}

/**
 * Every slot and spillover spot. Kids gathering around a parent may stand
 * among scenery: it's low, and they're only there for a while.
 */
function slotSpots(definition: WorldDefinition): Vec3[] {
  return Object.values(definition.areas).flatMap((area) =>
    area.kind === "fixed"
      ? [...area.slots, ...(area.spillover ?? [])].map((slot) => slot.position)
      : [],
  );
}

function spotKeepouts(definition: WorldDefinition, spots: ReadonlyArray<Vec3>): Keepout[] {
  const keepouts: Keepout[] = spots.map((spot) => point(spot, SPOT));
  for (const area of Object.values(definition.areas)) {
    if (area.kind !== "fixed") continue;
    for (const slot of area.slots) {
      // A lying agent reaches past its slot both ways; a rock pile stands ahead of it.
      keepouts.push(along(slot.position, slot.facing, -1.2, 1.2 * (area.slotPropScale ?? 1), SPOT));
      if (slot.via !== undefined) keepouts.push(segment(slot.via, slot.position, ROAD));
    }
  }
  return keepouts;
}

/** The props, the sign and the manager. */
function layoutKeepouts(definition: WorldDefinition): Keepout[] {
  const keepouts: Keepout[] = [];
  for (const prop of definition.props) {
    keepouts.push(
      prop.kind === "pier"
        ? along(prop.position, prop.facing, 0, prop.length ?? 1, 1.2)
        : point(prop.position, PROP_ROOM[prop.kind] * (prop.scale ?? 1)),
    );
  }
  keepouts.push(point(definition.archipelago.sign.position, 1.1));
  keepouts.push(point(definition.archipelago.manager.position, 0.9));
  return keepouts;
}

const PROP_ROOM: Record<PropKind, number> = {
  towel: 1,
  beachChair: 1,
  pier: 1.2,
  palm: 0.7,
  rockPile: 1,
  boulder: 1.7,
  tree: 0.9,
  sibipiruna: 0.7,
  lamp: 0.35,
  rock: 0.3,
  grass: 0.25,
};

const point = (at: Vec3, radius: number): Keepout => ({
  from: [at[0], at[2]],
  to: [at[0], at[2]],
  radius,
});

const segment = (from: Vec3, to: Vec3, radius: number): Keepout => ({
  from: [from[0], from[2]],
  to: [to[0], to[2]],
  radius,
});

/** From `start` to `end` units along a facing, from `at`. */
const along = (at: Vec3, facing: number, start: number, end: number, radius: number): Keepout => ({
  from: [at[0] + Math.sin(facing) * start, at[2] + Math.cos(facing) * start],
  to: [at[0] + Math.sin(facing) * end, at[2] + Math.cos(facing) * end],
  radius,
});

function segmentDistance(x: number, z: number, keepout: Keepout): number {
  const [ax, az] = keepout.from;
  const dx = keepout.to[0] - ax;
  const dz = keepout.to[1] - az;
  const lengthSquared = dx * dx + dz * dz;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

function pointIn(patch: TerrainPatch, random: () => number): readonly [x: number, z: number] {
  if (patch.shape === "box") {
    return [
      patch.center[0] + (random() - 0.5) * patch.size[0],
      patch.center[1] + (random() - 0.5) * patch.size[1],
    ];
  }
  // Square root: even over the disc's area rather than bunched at its centre.
  const distance = Math.sqrt(random()) * patch.radius;
  const angle = random() * Math.PI * 2;
  return [
    patch.center[0] + Math.cos(angle) * distance,
    patch.center[1] + Math.sin(angle) * distance,
  ];
}

/** How far inside the patch's edge x/z is; negative outside it. */
function edgeDistance(patch: TerrainPatch, x: number, z: number): number {
  const dx = x - patch.center[0];
  const dz = z - patch.center[1];
  if (patch.shape === "disc") return patch.radius - Math.hypot(dx, dz);
  return Math.min(patch.size[0] / 2 - Math.abs(dx), patch.size[1] / 2 - Math.abs(dz));
}

/** Whether ground drawn over `kind` reaches within `radius` of x/z. */
function covered(
  terrain: ReadonlyArray<TerrainPatch>,
  kind: TerrainKind,
  x: number,
  z: number,
  radius: number,
): boolean {
  return terrain.some(
    (patch) => LAYER[patch.kind] > LAYER[kind] && edgeDistance(patch, x, z) > -radius,
  );
}
