import {
  CircleGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LatheGeometry,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  Vector2,
} from "three";

import type { TerrainKind } from "../definition/types";
import { hashString } from "../engine/hash";
import { toFaded } from "./lighting";
import { palette } from "./palette";

const SEGMENTS = 96;
/** How far the shore wanders in and out of its circle, in world units. */
const WOBBLE: Record<TerrainKind, number> = { sand: 0.18, grass: 0.32, path: 0 };
/** Sand down the shoulder darkens toward this, like sand the waves keep wet. */
const WET_SAND = "#e6d196";
/** Grains per world unit along each axis of the sand's noise texture. */
const GRAIN_DENSITY = 24;
const GRAIN_SIZE = 128;

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
  const uvs: number[] = [];
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
    // Laid flat over the patch, so grains keep one size from centre to shore.
    uvs.push(
      (positions.getX(index) * GRAIN_DENSITY) / GRAIN_SIZE,
      (positions.getZ(index) * GRAIN_DENSITY) / GRAIN_SIZE,
    );
    // Darken with depth below the top, so the shoulder shades into wet sand.
    color.copy(dry).lerp(wet, Math.min(1, (top - y) / 0.2));
    colors.push(color.r, color.g, color.b);
  }
  lathe.setAttribute("color", new Float32BufferAttribute(colors, 3));
  lathe.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  lathe.computeVertexNormals();
  cache.set(key, lathe);
  return lathe;
}

let grain: DataTexture | undefined;

/**
 * Tiling greyscale noise that darkens the sand grain by grain, used as the
 * sand's `map` over its vertex colours. Seeded, so every island looks the same.
 */
export function sandGrainTexture(): DataTexture {
  if (grain !== undefined) return grain;
  const data = new Uint8Array(GRAIN_SIZE * GRAIN_SIZE * 4);
  let seed = 0x5eed;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  for (let index = 0; index < GRAIN_SIZE * GRAIN_SIZE; index += 1) {
    // Mostly fine variation, with the odd darker speck.
    const speck = random() < 0.06 ? 0.12 : 0;
    const value = Math.round(255 * (1 - 0.14 * random() - speck));
    data.set([value, value, value, 255], index * 4);
  }
  grain = new DataTexture(data, GRAIN_SIZE, GRAIN_SIZE);
  grain.wrapS = RepeatWrapping;
  grain.wrapT = RepeatWrapping;
  // Crisp grains up close, averaged out from afar instead of shimmering.
  grain.minFilter = LinearMipmapLinearFilter;
  grain.generateMipmaps = true;
  grain.anisotropy = 4;
  grain.needsUpdate = true;
  return grain;
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
