import {
  BufferGeometry,
  Float32BufferAttribute,
  type Matrix4,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { Direction } from "./daylight";

/**
 * Ground shadows darken a pixel once, however many overlap there: the first
 * marks the stencil buffer, and the rest skip marked pixels. The canvas needs
 * a stencil buffer for this.
 */
export const SHADOW_STENCIL = {
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: NotEqualStencilFunc,
  stencilZPass: ReplaceStencilOp,
} as const;

export interface Caster {
  readonly geometry: BufferGeometry;
  /** Places the geometry on the island. */
  readonly matrix: Matrix4;
}

/** The ground's height at (x, z); flat by default. */
export type Ground = (x: number, z: number) => number;
const flat: Ground = () => 0;

const cache = new Map<string, BufferGeometry | null>();

/**
 * The casters' shadows on the ground, merged into one flat mesh so they cost
 * a single draw: each shape squashed onto the ground along the light's rays.
 * Built once per `key` and light direction; the light moves in steps through
 * the day (see `daylight.ts`), so each step's shadows are built once.
 */
export function castShadows(
  key: string,
  casters: () => ReadonlyArray<Caster>,
  light: Direction,
  ground: Ground = flat,
): BufferGeometry | null {
  const fullKey = `${light.join(",")}|${key}`;
  const cached = cache.get(fullKey);
  if (cached !== undefined) return cached;
  const shadows = casters().map((caster) => flatten(caster.geometry, ground, light, caster.matrix));
  const merged = shadows.length === 0 ? null : mergeGeometries(shadows);
  for (const shadow of shadows) shadow.dispose();
  cache.set(fullKey, merged);
  return merged;
}

const ownShadows = new WeakMap<BufferGeometry, Map<string, BufferGeometry>>();

/** The shadow of a geometry already placed on the island, e.g. its merged scenery. */
export function shadowOf(
  geometry: BufferGeometry,
  light: Direction,
  ground: Ground = flat,
): BufferGeometry {
  let byLight = ownShadows.get(geometry);
  if (byLight === undefined) {
    byLight = new Map();
    ownShadows.set(geometry, byLight);
  }
  const key = light.join(",");
  let shadow = byLight.get(key);
  if (shadow === undefined) {
    shadow = flatten(geometry, ground, light);
    byLight.set(key, shadow);
  }
  return shadow;
}

/**
 * The geometry's lit faces pressed flat onto the ground along the light's
 * rays: together they cover its whole shadow, and the faces turned away would
 * only draw over them again. Anything below the ground stays where it is.
 * Heights count from the ground under each point, and the shadow lies on the
 * ground where it lands.
 */
function flatten(
  geometry: BufferGeometry,
  ground: Ground,
  light: Direction,
  matrix?: Matrix4,
): BufferGeometry {
  const source = geometry.getAttribute("position");
  const points = Array.from({ length: source.count }, (_, index) => {
    const point = new Vector3().fromBufferAttribute(source, index);
    return matrix === undefined ? point : point.applyMatrix4(matrix);
  });
  const corners = geometry.index?.array ?? points.map((_, index) => index);
  const toLight = new Vector3(...light);
  const edge = new Vector3();
  const other = new Vector3();
  const lit: number[] = [];
  for (let index = 0; index + 2 < corners.length; index += 3) {
    const [a, b, c] = [corners[index]!, corners[index + 1]!, corners[index + 2]!];
    edge.subVectors(points[b]!, points[a]!);
    other.subVectors(points[c]!, points[a]!);
    if (edge.cross(other).dot(toLight) > 0) lit.push(a, b, c);
  }
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    const height = Math.max(point.y - ground(point.x, point.z), 0);
    const x = point.x - (toLight.x / toLight.y) * height;
    const z = point.z - (toLight.z / toLight.y) * height;
    positions.set([x, ground(x, z), z], index * 3);
  });
  const shadow = new BufferGeometry();
  shadow.setAttribute("position", new Float32BufferAttribute(positions, 3));
  shadow.setIndex(lit);
  return shadow;
}
