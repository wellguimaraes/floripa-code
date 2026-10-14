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

import type { TerrainKind, WorldDefinition } from "../definition/types";
import { hashString } from "../engine/hash";
import { toFaded } from "./lighting";
import { palette } from "./palette";

const SEGMENTS = 96;
/** How far the shore wanders in and out of its circle, in world units. */
const WOBBLE: Record<TerrainKind, number> = { sand: 0.18, grass: 0.32, path: 0 };
/** Sand down the shoulder darkens toward this, like sand the waves keep wet. */
const WET_SAND = "#e6d196";
/** How far below its top a patch's edge reaches its darkest. */
const SHADE_DEPTH: Record<TerrainKind, number> = { sand: 0.2, grass: 0.15, path: 1 };

/**
 * Each terrain's surface height. Patches stack a hair apart so overlaps never
 * z-fight; the lawn stands a step above the sand.
 */
export const TERRAIN_TOP: Record<TerrainKind, number> = { sand: 0, grass: 0.15, path: 0.02 };
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
  // The lawn stands a step above the sand, its edge a soft rounded bank.
  return [
    [0, top],
    [radius - 0.45, top],
    [radius - 0.25, top - 0.015],
    [radius - 0.12, top - 0.05],
    [radius - 0.04, top - 0.11],
    [radius, -0.01],
  ].map(([x, y]) => new Vector2(x, y));
}

/** How much the wobbling outline pushes a patch's edge out at `angle`. */
function wobbleAt(kind: TerrainKind, radius: number, top: number): (angle: number) => number {
  const seed = hashString(`${kind}:${radius}:${top}`) % 1000;
  const wobble = WOBBLE[kind];
  return (angle) => {
    const wave = Math.sin(3 * angle + seed) * 0.6 + Math.sin(5 * angle + seed * 2) * 0.4;
    return 1 + (wobble * wave) / radius;
  };
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
  const wobble = wobbleAt(kind, radius, top);
  const positions = lathe.getAttribute("position");
  const colors: number[] = [];
  const uvs: number[] = [];
  const shade = (color: string) => new Color(faded ? toFaded(color) : color);
  const dry = shade(kind === "sand" ? palette.sand : palette.grass);
  const wet = shade(kind === "sand" ? WET_SAND : palette.grassBank);
  const color = new Color();
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const y = positions.getY(index);
    const distance = Math.hypot(x, z);
    if (distance > 0) {
      const scale = wobble(Math.atan2(x, z));
      positions.setXYZ(index, x * scale, y, z * scale);
    }
    // Laid flat over the patch, so grains keep one size from centre to shore.
    uvs.push(
      (positions.getX(index) * GRAIN_DENSITY) / GRAIN_SIZE,
      (positions.getZ(index) * GRAIN_DENSITY) / GRAIN_SIZE,
    );
    // Darken with depth below the top, so the shoulder shades into wet sand
    // and the lawn's bank into deeper green.
    color.copy(dry).lerp(wet, Math.min(1, (top - y) / SHADE_DEPTH[kind]));
    colors.push(color.r, color.g, color.b);
  }
  lathe.setAttribute("color", new Float32BufferAttribute(colors, 3));
  lathe.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  lathe.computeVertexNormals();
  cache.set(key, lathe);
  return lathe;
}

const grounds = new WeakMap<WorldDefinition, (x: number, z: number) => number>();

/**
 * The height of an island's ground at (x, z), following its round patches'
 * surfaces (lawn top, banks and all), so whatever stands there sits on it.
 */
export function groundHeight(definition: WorldDefinition): (x: number, z: number) => number {
  let ground = grounds.get(definition);
  if (ground !== undefined) return ground;
  const surfaces = definition.terrain.flatMap((patch) => {
    if (patch.shape !== "disc" || TERRAIN_TOP[patch.kind] <= 0) return [];
    const top = TERRAIN_TOP[patch.kind];
    const wobble = wobbleAt(patch.kind, patch.radius, top);
    const section = profile(patch.kind, patch.radius, top);
    return [{ center: patch.center, wobble, section }];
  });
  ground = (x, z) => {
    let height = 0;
    for (const { center, wobble, section } of surfaces) {
      const dx = x - center[0];
      const dz = z - center[1];
      // Back to the circle the outline was wobbled from, then up the section.
      const along = Math.hypot(dx, dz) / wobble(Math.atan2(dx, dz));
      for (let index = 1; index < section.length; index += 1) {
        const from = section[index - 1]!;
        const to = section[index]!;
        if (along > to.x) continue;
        const t = (along - from.x) / (to.x - from.x);
        height = Math.max(height, from.y + (to.y - from.y) * Math.max(0, t));
        break;
      }
    }
    return height;
  };
  grounds.set(definition, ground);
  return ground;
}

const surfaces = new WeakMap<WorldDefinition, (x: number, z: number) => TerrainKind | null>();

/**
 * Which ground shows at (x, z) on an island, following its patches' wobbling
 * outlines: the highest patch there, or none off the island.
 */
export function surfaceAt(
  definition: WorldDefinition,
): (x: number, z: number) => TerrainKind | null {
  let surface = surfaces.get(definition);
  if (surface !== undefined) return surface;
  const patches = definition.terrain.toSorted((a, b) => TERRAIN_TOP[b.kind] - TERRAIN_TOP[a.kind]);
  const inside = patches.map((patch) => {
    if (patch.shape === "box") {
      return (x: number, z: number) =>
        Math.abs(x - patch.center[0]) <= patch.size[0] / 2 &&
        Math.abs(z - patch.center[1]) <= patch.size[1] / 2;
    }
    const wobble = wobbleAt(patch.kind, patch.radius, TERRAIN_TOP[patch.kind]);
    return (x: number, z: number) => {
      const dx = x - patch.center[0];
      const dz = z - patch.center[1];
      return Math.hypot(dx, dz) <= patch.radius * wobble(Math.atan2(dx, dz));
    };
  });
  surface = (x, z) => {
    const index = inside.findIndex((contains) => contains(x, z));
    return index === -1 ? null : patches[index]!.kind;
  };
  surfaces.set(definition, surface);
  return surface;
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
 * A flat disc with a gently wandering edge: the bands of clear shallow water
 * around an island, and the bands of green on its lawn. Built once per size
 * and shared.
 */
export function wavyDiscGeometry(radius: number): CircleGeometry {
  const key = `shallows:${radius}`;
  const cached = flatCache.get(key);
  if (cached !== undefined) return cached;
  const disc = new CircleGeometry(radius, SEGMENTS);
  disc.rotateX(-Math.PI / 2);
  const edge = wavyDiscEdge(radius);
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
 * How far the edge of `wavyDiscGeometry(radius)` sits outside its circle at
 * `angle` (measured from +z toward +x), so other shapes can follow it.
 */
export function wavyDiscEdge(radius: number): (angle: number) => number {
  const seed = hashString(`shallows:${radius}`) % 1000;
  return (angle) =>
    0.35 * (Math.sin(4 * angle + seed) * 0.5 + Math.sin(7 * angle + seed * 3) * 0.5);
}
