import type { PropKind, Vec3, WorldDefinition, WorldSlot } from "../definition/types";
import { islandScenery } from "./scenery";

/** Something a character walks around: a tree trunk, a rock pile, a sign post. */
export interface Obstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** Room left between a character and what it walks past. */
const CLEARANCE = 0.45;
/** Detours one walk may take before it just goes straight. */
const MAX_DETOURS = 6;

/**
 * Points a character walks through from where it stands to its spot: a
 * straight line, stepping around each obstacle in the way on the side it is
 * already passing. An obstacle at either end (the pile a miner stands at)
 * is not in the way.
 */
export function planRoute(input: {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly obstacles: ReadonlyArray<Obstacle>;
}): Vec3[] {
  const { to, obstacles } = input;
  const route: Vec3[] = [];
  let current = input.from;
  for (let detour = 0; detour < MAX_DETOURS; detour += 1) {
    const blocker = firstBlocker(current, to, obstacles);
    if (blocker === null) break;
    const { obstacle, closest } = blocker;
    // Push the closest point on the line out past the obstacle's edge.
    let awayX = closest[0] - obstacle.x;
    let awayZ = closest[2] - obstacle.z;
    let away = Math.hypot(awayX, awayZ);
    if (away < 1e-6) {
      // Dead centre: pick the left of the direction of travel.
      awayX = -(to[2] - current[2]);
      awayZ = to[0] - current[0];
      away = Math.hypot(awayX, awayZ) || 1;
    }
    const reach = obstacle.radius + CLEARANCE + 0.05;
    const waypoint: Vec3 = [
      obstacle.x + (awayX / away) * reach,
      to[1],
      obstacle.z + (awayZ / away) * reach,
    ];
    route.push(waypoint);
    current = waypoint;
  }
  route.push(to);
  return route.filter((point, index) => distance(point, route[index - 1] ?? input.from) > 1e-6);
}

/** The nearest obstacle the segment passes too close to, with the segment's closest point to it. */
function firstBlocker(
  from: Vec3,
  to: Vec3,
  obstacles: ReadonlyArray<Obstacle>,
): { readonly obstacle: Obstacle; readonly closest: Vec3 } | null {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 1e-9) return null;
  let best: { obstacle: Obstacle; closest: Vec3; t: number } | null = null;
  for (const obstacle of obstacles) {
    const reach = obstacle.radius + CLEARANCE;
    // Standing next to it at either end is the point of the walk, not a collision.
    if (Math.hypot(from[0] - obstacle.x, from[2] - obstacle.z) < reach) continue;
    if (Math.hypot(to[0] - obstacle.x, to[2] - obstacle.z) < reach) continue;
    const t = Math.min(
      1,
      Math.max(0, ((obstacle.x - from[0]) * dx + (obstacle.z - from[2]) * dz) / lengthSquared),
    );
    const closest: Vec3 = [from[0] + dx * t, from[1], from[2] + dz * t];
    if (Math.hypot(closest[0] - obstacle.x, closest[2] - obstacle.z) >= reach) continue;
    if (best === null || t < best.t) best = { obstacle, closest, t };
  }
  return best;
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** How much room each kind of prop takes at walking height. */
const FOOTPRINTS: Partial<Record<PropKind, number>> = {
  tree: 0.45,
  // Trunk only: the crown is overhead.
  palm: 0.3,
  sibipiruna: 0.35,
  beachChair: 0.45,
  rockPile: 0.65,
  boulder: 1.1,
  lamp: 0.2,
  rock: 0.3,
};
/** A rock pile stands this far in front of its slot (see the `rockPile` prop). */
const PILE_AHEAD = 0.95;

const obstacleCache = new WeakMap<WorldDefinition, Obstacle[]>();

/** Everything on an island a character walks around, from its definition. */
export function islandObstacles(definition: WorldDefinition): Obstacle[] {
  const cached = obstacleCache.get(definition);
  if (cached !== undefined) return cached;
  const obstacles: Obstacle[] = [];
  const add = (kind: PropKind, slot: Pick<WorldSlot, "position" | "facing">, scale = 1) => {
    const footprint = FOOTPRINTS[kind];
    if (footprint === undefined) return;
    const ahead = kind === "rockPile" ? PILE_AHEAD * scale : 0;
    obstacles.push({
      x: slot.position[0] + Math.sin(slot.facing) * ahead,
      z: slot.position[2] + Math.cos(slot.facing) * ahead,
      radius: footprint * scale,
    });
  };
  for (const prop of [...definition.props, ...islandScenery(definition)]) {
    add(prop.kind, prop, prop.scale);
  }
  for (const area of Object.values(definition.areas)) {
    if (area.kind !== "fixed") continue;
    for (const slot of area.slots) {
      const kind = slot.prop ?? area.slotProp;
      if (kind !== undefined) add(kind, slot, area.slotPropScale);
    }
  }
  // The sign's post.
  obstacles.push({
    x: definition.archipelago.sign.position[0],
    z: definition.archipelago.sign.position[2],
    radius: 0.4,
  });
  obstacleCache.set(definition, obstacles);
  return obstacles;
}
