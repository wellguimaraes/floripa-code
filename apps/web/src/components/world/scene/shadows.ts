import {
  BufferGeometry,
  Float32BufferAttribute,
  type Matrix4,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Where the sun is, as in WorldCanvas's directional light. */
const SUN = new Vector3(6, 14, 9);

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

const cache = new Map<string, BufferGeometry | null>();

/**
 * The casters' shadows on the ground, merged into one flat mesh so they cost
 * a single draw: each shape squashed onto the ground along the sun's rays.
 * Built once per `key`.
 */
export function castShadows(
  key: string,
  casters: () => ReadonlyArray<Caster>,
): BufferGeometry | null {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const shadows = casters().map((caster) => flatten(caster.geometry, caster.matrix));
  const merged = shadows.length === 0 ? null : mergeGeometries(shadows);
  for (const shadow of shadows) shadow.dispose();
  cache.set(key, merged);
  return merged;
}

const ownShadows = new WeakMap<BufferGeometry, BufferGeometry>();

/** The shadow of a geometry already placed on the island, e.g. its merged scenery. */
export function shadowOf(geometry: BufferGeometry): BufferGeometry {
  let shadow = ownShadows.get(geometry);
  if (shadow === undefined) {
    shadow = flatten(geometry);
    ownShadows.set(geometry, shadow);
  }
  return shadow;
}

/**
 * The geometry's sunlit faces pressed flat onto the ground along the sun's
 * rays: together they cover its whole shadow, and the faces turned away would
 * only draw over them again. Anything below the ground stays where it is.
 */
function flatten(geometry: BufferGeometry, matrix?: Matrix4): BufferGeometry {
  const source = geometry.getAttribute("position");
  const points = Array.from({ length: source.count }, (_, index) => {
    const point = new Vector3().fromBufferAttribute(source, index);
    return matrix === undefined ? point : point.applyMatrix4(matrix);
  });
  const corners = geometry.index?.array ?? points.map((_, index) => index);
  const toSun = SUN.clone().normalize();
  const edge = new Vector3();
  const other = new Vector3();
  const lit: number[] = [];
  for (let index = 0; index + 2 < corners.length; index += 3) {
    const [a, b, c] = [corners[index]!, corners[index + 1]!, corners[index + 2]!];
    edge.subVectors(points[b]!, points[a]!);
    other.subVectors(points[c]!, points[a]!);
    if (edge.cross(other).dot(toSun) > 0) lit.push(a, b, c);
  }
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    const height = Math.max(point.y, 0);
    positions.set(
      [point.x - (SUN.x / SUN.y) * height, 0, point.z - (SUN.z / SUN.y) * height],
      index * 3,
    );
  });
  const shadow = new BufferGeometry();
  shadow.setAttribute("position", new Float32BufferAttribute(positions, 3));
  shadow.setIndex(lit);
  return shadow;
}
