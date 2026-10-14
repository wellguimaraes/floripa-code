import { useLoader } from "@react-three/fiber";
import { type BufferGeometry, Color, Float32BufferAttribute, type Mesh, type Matrix4 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { SceneryKind, WorldDefinition } from "../definition/types";
import { hashString } from "../engine/hash";
import { islandScenery, isScenery, SCENERY_SIZE } from "../engine/scenery";
import { toFaded } from "./lighting";
import { chain, rotateY, scale, translate } from "./merged";
import { palette } from "./palette";

// KayKit Forest Nature Pack (CC0), trimmed to these models; see public/world/LICENSE.txt.
const NATURE_URL = `${import.meta.env.BASE_URL}world/nature.glb`;

const MODELS: Record<SceneryKind, ReadonlyArray<string>> = {
  rock: ["Rock_1_A", "Rock_1_B", "Rock_1_C", "Rock_2_B", "Rock_3_E", "Rock_3_F"],
  grass: ["Grass_1_A", "Grass_1_B", "Grass_2_A", "Grass_2_B"],
};

/**
 * The pack's texture is gradients stacked top to bottom (leaves, bark, stone),
 * and every vertex's v picks a band and a point down it. These redraw the
 * bands the models use from light to dark in the world's own colours.
 */
const RAMPS: Readonly<Record<number, readonly [light: string, dark: string]>> = {
  0: [palette.leafLight, palette.leafDark],
  2: [palette.stoneLight, palette.stoneDark],
};
const BANDS = 4;

export type NatureModels = ReadonlyMap<string, BufferGeometry>;

/** The pack's models by name. Suspends until the file has loaded. */
export function useNatureModels(): NatureModels {
  const gltf = useLoader(GLTFLoader, NATURE_URL);
  let models = loaded.get(gltf.scene);
  if (models === undefined) {
    const byName = new Map<string, BufferGeometry>();
    gltf.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) byName.set(mesh.name, mesh.geometry);
    });
    models = byName;
    loaded.set(gltf.scene, models);
  }
  return models;
}
const loaded = new WeakMap<object, NatureModels>();

interface Placement {
  readonly model: string;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  /** Scaled to stand this tall. */
  readonly height: number;
}

const sceneryCache = new WeakMap<WorldDefinition, Map<boolean, BufferGeometry>>();

/**
 * Every pebble and grass tuft on an island as one mesh, so an
 * island's scenery is a single draw. Built once per definition and shared by
 * every island of that size.
 */
export function sceneryGeometry(
  models: NatureModels,
  definition: WorldDefinition,
  faded: boolean,
): BufferGeometry | null {
  let byFaded = sceneryCache.get(definition);
  if (byFaded === undefined) {
    byFaded = new Map();
    sceneryCache.set(definition, byFaded);
  }
  const cached = byFaded.get(faded);
  if (cached !== undefined) return cached;
  const placements = [...definition.props, ...islandScenery(definition)].flatMap(
    (prop): Placement[] => {
      if (!isScenery(prop.kind)) return [];
      const choices = MODELS[prop.kind];
      return [
        {
          model: choices[hashString(prop.position.join(",")) % choices.length]!,
          x: prop.position[0],
          z: prop.position[2],
          facing: prop.facing,
          height: SCENERY_SIZE[prop.kind].height * (prop.scale ?? 1),
        },
      ];
    },
  );
  const merged = placements.length === 0 ? null : bake(models, placements, faded);
  if (merged !== null) byFaded.set(faded, merged);
  return merged;
}

/** The placed models merged into one geometry, coloured per vertex. */
function bake(
  models: NatureModels,
  placements: ReadonlyArray<Placement>,
  faded: boolean,
): BufferGeometry {
  const parts = placements.map((placement) => {
    const source = models.get(placement.model);
    if (source === undefined) throw new Error(`Missing nature model "${placement.model}".`);
    if (source.boundingBox === null) source.computeBoundingBox();
    // Measured from the ground: stones sunk halfway in count only what shows.
    const size = placement.height / source.boundingBox!.max.y;
    const matrix: Matrix4 = chain(
      translate(placement.x, 0, placement.z),
      rotateY(placement.facing),
      scale(size),
    );
    const part = source.clone().applyMatrix4(matrix);
    part.setAttribute("color", new Float32BufferAttribute(vertexColors(source, faded), 3));
    part.deleteAttribute("uv");
    return part;
  });
  const merged = mergeGeometries(parts)!;
  for (const part of parts) part.dispose();
  return merged;
}

const colorCache = new Map<string, Float32Array>();

function vertexColors(source: BufferGeometry, faded: boolean): Float32Array {
  const key = `${source.uuid}:${faded}`;
  const cached = colorCache.get(key);
  if (cached !== undefined) return cached;
  const shade = (color: string) => new Color(faded ? toFaded(color) : color);
  const uv = source.getAttribute("uv");
  const colors = new Float32Array(uv.count * 3);
  const color = new Color();
  for (let index = 0; index < uv.count; index += 1) {
    const along = uv.getY(index) * BANDS;
    const band = Math.floor(along);
    const ramp = RAMPS[band];
    if (ramp === undefined) throw new Error(`Nature model uses unknown colour band ${band}.`);
    color.copy(shade(ramp[0])).lerp(shade(ramp[1]), along - band);
    colors.set([color.r, color.g, color.b], index * 3);
  }
  colorCache.set(key, colors);
  return colors;
}
