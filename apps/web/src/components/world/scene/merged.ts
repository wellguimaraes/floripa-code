import { type BufferGeometry, Matrix4 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Part {
  readonly geometry: BufferGeometry;
  readonly matrix: Matrix4;
  readonly color: string;
  /** Faceted, e.g. a rock or a crown of leaves. */
  readonly flat?: boolean;
}

export interface MergedPart {
  readonly geometry: BufferGeometry;
  readonly color: string;
  readonly flat: boolean;
}

const cache = new Map<string, ReadonlyArray<MergedPart>>();

/**
 * Bakes many small parts into one mesh per colour and shading, built once per `key` and
 * shared. A prop made of dozens of pieces (a palm, a rock pile) then costs a
 * draw call per colour instead of one per piece.
 */
export function mergedParts(
  key: string,
  build: () => ReadonlyArray<Part>,
): ReadonlyArray<MergedPart> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const groups = new Map<string, { color: string; flat: boolean; pieces: BufferGeometry[] }>();
  for (const part of build()) {
    const flat = part.flat ?? false;
    const group = groups.get(`${part.color}:${flat}`) ?? { color: part.color, flat, pieces: [] };
    group.pieces.push(part.geometry.clone().applyMatrix4(part.matrix));
    groups.set(`${part.color}:${flat}`, group);
  }
  const merged = [...groups.values()].map(({ color, flat, pieces }) => {
    const geometry = mergeGeometries(pieces)!;
    for (const piece of pieces) piece.dispose();
    return { color, flat, geometry };
  });
  cache.set(key, merged);
  return merged;
}

/** A transform built like nested groups: each step applies inside the previous. */
export function chain(...steps: ReadonlyArray<Matrix4>): Matrix4 {
  return steps.reduce((total, step) => total.multiply(step), new Matrix4());
}

export const translate = (x: number, y: number, z: number) =>
  new Matrix4().makeTranslation(x, y, z);
export const rotateX = (angle: number) => new Matrix4().makeRotationX(angle);
export const rotateY = (angle: number) => new Matrix4().makeRotationY(angle);
export const rotateZ = (angle: number) => new Matrix4().makeRotationZ(angle);
export const scale = (x: number, y = x, z = x) => new Matrix4().makeScale(x, y, z);
