import { CircleGeometry, Color, Float32BufferAttribute, LatheGeometry, Vector2 } from "three";

import type { TerrainKind } from "../definition/types";
import { hashString } from "../engine/hash";
import { toFaded } from "./lighting";
import { palette } from "./palette";

const SEGMENTS = 96;
/** How far the shore wanders in and out of its circle, in world units. */
const WOBBLE: Record<TerrainKind, number> = { sand: 0.18, grass: 0.32, path: 0 };
/** Sand down the shoulder darkens toward this, like sand the waves keep wet. */
const WET_SAND = "#d9bd7c";

/**
 * Half-section of a round patch, from its centre out and down: a flat top
 * that curves over a soft shoulder into the water, so the island reads as a
 * mound rather than a cut-out disc. `top` is the patch's surface height.
 */
function profile(kind: TerrainKind, radius: number, top: number): Vector2[] {
  if (kind === "sand") {
    return [
      [0, top],
      [radius - 0.55, top],
      [radius - 0.3, top - 0.03],
      [radius - 0.12, top - 0.1],
      [radius, top - 0.22],
      [radius + 0.04, top - 0.36],
      [radius - 0.2, top - 0.6],
    ].map(([x, y]) => new Vector2(x, y));
  }
  // The lawn only rounds off at its edge, where it meets the sand.
  return [
    [0, top],
    [radius - 0.3, top],
    [radius - 0.1, top - 0.006],
    [radius, top - 0.02],
  ].map(([x, y]) => new Vector2(x, y));
}

const cache = new Map<string, LatheGeometry>();

/**
 * A round terrain patch as one smooth mesh, its outline wobbling a little so
 * the shore is not a perfect circle. Built once per patch and shared.
 */
export function roundPatchGeometry(
  kind: TerrainKind,
  radius: number,
  top: number,
  faded: boolean,
): LatheGeometry {
  const key = `${kind}:${radius}:${top}:${faded}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  // Lathe faces point outward when the section runs bottom to top.
  const points = profile(kind, radius, top).toReversed();
  const lathe = new LatheGeometry(points, SEGMENTS);
  const seed = hashString(`${kind}:${radius}:${top}`) % 1000;
  const wobble = WOBBLE[kind];
  const positions = lathe.getAttribute("position");
  const colors: number[] = [];
  const shade = (color: string) => new Color(faded ? toFaded(color) : color);
  const dry = shade(kind === "sand" ? palette.sand : palette.grass);
  const wet = shade(kind === "sand" ? WET_SAND : palette.grass);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const y = positions.getY(index);
    const distance = Math.hypot(x, z);
    if (distance > 0) {
      const angle = Math.atan2(x, z);
      const wave = Math.sin(3 * angle + seed) * 0.6 + Math.sin(5 * angle + seed * 2) * 0.4;
      const scale = 1 + (wobble * wave) / radius;
      positions.setXYZ(index, x * scale, y, z * scale);
    }
    // Darken with depth below the top, so the shoulder shades into wet sand.
    color.copy(dry).lerp(wet, Math.min(1, (top - y) / 0.2));
    colors.push(color.r, color.g, color.b);
  }
  lathe.setAttribute("color", new Float32BufferAttribute(colors, 3));
  lathe.computeVertexNormals();
  cache.set(key, lathe);
  return lathe;
}

/**
 * A flat disc with a gently wandering edge, lying on the water: the bands of
 * clear shallow water around an island. Built once per size and shared.
 */
export function shallowsGeometry(radius: number): CircleGeometry {
  const key = `shallows:${radius}`;
  const cached = flatCache.get(key);
  if (cached !== undefined) return cached;
  const disc = new CircleGeometry(radius, SEGMENTS);
  disc.rotateX(-Math.PI / 2);
  const edge = shallowsEdge(radius);
  const positions = disc.getAttribute("position");
  for (let index = 1; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const scale = 1 + edge(Math.atan2(x, z)) / radius;
    positions.setXYZ(index, x * scale, 0, z * scale);
  }
  disc.computeVertexNormals();
  flatCache.set(key, disc);
  return disc;
}

const flatCache = new Map<string, CircleGeometry>();

/**
 * How far the edge of `shallowsGeometry(radius)` sits outside its circle at
 * `angle` (measured from +z toward +x), so other shapes can follow it.
 */
export function shallowsEdge(radius: number): (angle: number) => number {
  const seed = hashString(`shallows:${radius}`) % 1000;
  return (angle) =>
    0.35 * (Math.sin(4 * angle + seed) * 0.5 + Math.sin(7 * angle + seed * 3) * 0.5);
}
