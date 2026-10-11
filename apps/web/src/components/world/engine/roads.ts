import type { Vec3, WorldRoads } from "../definition/types";
import type { Placement } from "./slots";

/**
 * Points a character walks through to get from where it stands to its new
 * spot. Moving within one area is a straight line; moving between areas goes
 * to the nearest road node, along the shortest road path, then to the spot.
 */
export function planRoute(input: {
  readonly roads: WorldRoads;
  readonly from: Vec3;
  readonly fromPlacement: Placement | null;
  readonly to: Placement;
}): Vec3[] {
  const { roads, from, fromPlacement, to } = input;
  if (
    fromPlacement !== null &&
    fromPlacement.area === to.area &&
    fromPlacement.entry === to.entry
  ) {
    return dedupe([from, to.position]);
  }
  const start = nearestNode(roads, from);
  const nodes = start === null ? [] : (shortestPath(roads, start, to.entry) ?? []);
  return dedupe([from, ...nodes.map((node) => roads.nodes[node]!), to.position]);
}

/** Dijkstra over the road graph; roads are two-way. Null when unreachable. */
export function shortestPath(roads: WorldRoads, start: string, goal: string): string[] | null {
  if (!(start in roads.nodes) || !(goal in roads.nodes)) return null;
  const distance = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, string>();
  const open = new Set([start]);
  while (open.size > 0) {
    let current: string | null = null;
    for (const node of open) {
      if (current === null || distance.get(node)! < distance.get(current)!) current = node;
    }
    open.delete(current!);
    if (current === goal) break;
    for (const [a, b] of roads.edges) {
      const next = a === current ? b : b === current ? a : null;
      if (next === null) continue;
      const candidate =
        distance.get(current!)! + length(roads.nodes[current!]!, roads.nodes[next]!);
      if (candidate < (distance.get(next) ?? Infinity)) {
        distance.set(next, candidate);
        previous.set(next, current!);
        open.add(next);
      }
    }
  }
  if (!distance.has(goal)) return null;
  const path = [goal];
  while (path[0] !== start) path.unshift(previous.get(path[0]!)!);
  return path;
}

function nearestNode(roads: WorldRoads, point: Vec3): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const [node, position] of Object.entries(roads.nodes)) {
    const candidate = length(point, position);
    if (candidate < bestDistance) {
      best = node;
      bestDistance = candidate;
    }
  }
  return best;
}

function length(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function dedupe(points: ReadonlyArray<Vec3>): Vec3[] {
  return points.filter((point, index) => index === 0 || length(point, points[index - 1]!) > 1e-6);
}
