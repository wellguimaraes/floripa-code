import { type BufferGeometry, CircleGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { PropKind } from "../definition/types";

/** How far a shadow moves along the ground per unit of height, away from the sun. */
const SUN: readonly [x: number, z: number] = [-6 / 14, -9 / 14];

/** What casts a shadow, and from where: the height of its bulk and its size there. */
const CASTERS: Partial<
  Record<PropKind, { readonly height: number; readonly radius: number; readonly ahead?: number }>
> = {
  // Its crown, which leans out from the trunk.
  palm: { height: 2.6, radius: 1.15 },
  tree: { height: 1.25, radius: 0.8 },
  // The pile sits in front of its slot, where the parent mines it.
  rockPile: { height: 0.3, radius: 0.7, ahead: 0.95 },
};
/** How far a palm's crown leans out from its foot, on average. */
const PALM_LEAN = 0.65;

const cache = new Map<string, BufferGeometry | null>();

/**
 * Soft round shadows under an island's trees, palms and rock piles,
 * cast away from the sun, baked into one flat mesh so they cost a single draw.
 */
export function propShadows(
  props: ReadonlyArray<{
    readonly kind: PropKind;
    readonly position: readonly [number, number, number];
    readonly facing: number;
    readonly scale?: number | undefined;
  }>,
): BufferGeometry | null {
  const key = props
    .filter((prop) => CASTERS[prop.kind] !== undefined)
    .map((prop) => `${prop.kind}:${prop.position.join(",")}:${prop.facing}:${prop.scale ?? 1}`)
    .join("|");
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const discs = props.flatMap((prop) => {
    const caster = CASTERS[prop.kind];
    if (caster === undefined) return [];
    const scale = prop.scale ?? 1;
    let x = prop.position[0] + SUN[0] * caster.height * scale;
    let z = prop.position[2] + SUN[1] * caster.height * scale;
    // A facing of f looks toward (sin f, cos f); a palm leans along its local +x.
    if (caster.ahead !== undefined) {
      x += Math.sin(prop.facing) * caster.ahead * scale;
      z += Math.cos(prop.facing) * caster.ahead * scale;
    }
    if (prop.kind === "palm") {
      x += Math.cos(prop.facing) * PALM_LEAN;
      z -= Math.sin(prop.facing) * PALM_LEAN;
    }
    const disc = new CircleGeometry(caster.radius * scale, 20);
    disc.rotateX(-Math.PI / 2);
    disc.translate(x, 0, z);
    return [disc];
  });
  const merged = discs.length === 0 ? null : mergeGeometries(discs);
  for (const disc of discs) disc.dispose();
  cache.set(key, merged);
  return merged;
}
