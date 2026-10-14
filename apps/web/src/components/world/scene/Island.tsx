import { Suspense, useContext, useMemo } from "react";
import { type BufferGeometry, DoubleSide, Matrix4 } from "three";

import type { PropKind, TerrainKind, Vec3, WorldDefinition } from "../definition/types";
import { islandBounds } from "../engine/archipelago";
import { hashString } from "../engine/hash";
import { isScenery } from "../engine/scenery";
import { geometry } from "./geometries";
import { FadedContext, LitMaterial } from "./lighting";
import {
  chain,
  type MergedPart,
  mergedParts,
  type Part,
  rotateX,
  rotateY,
  rotateZ,
  scale,
  translate,
} from "./merged";
import { sceneryGeometry, useNatureModels } from "./nature";
import { palette } from "./palette";
import { Ripple } from "./Ripple";
import { castShadows, type Ground, SHADOW_STENCIL, shadowOf } from "./shadows";
import {
  groundHeight,
  roundPatchGeometry,
  sandGrainTexture,
  wavyDiscEdge,
  wavyDiscGeometry,
  TERRAIN_TOP,
} from "./terrain";

const TERRAIN_COLOR: Record<TerrainKind, string> = {
  sand: palette.sand,
  grass: palette.grass,
  path: palette.path,
};
const TERRAIN_DEPTH = 0.6;

export interface FurnitureSpot {
  readonly kind: PropKind;
  readonly position: Vec3;
  readonly facing: number;
  readonly scale: number;
}

/** Each of `palette.lawnBands`' radius, as a share of the lawn's. */
const LAWN_BANDS = [0.8, 0.58, 0.34];

/** How far the outer shallows reach past a sand patch's edge. */
const LAGOON_REACH = 2.1;

/**
 * The outline the ripple follows: the outer shallows around the island's sand,
 * or a plain circle around the island when it has no round sand patch.
 */
function rippleShore(definition: WorldDefinition): {
  readonly center: readonly [x: number, z: number];
  readonly radius: number;
  readonly edge: (angle: number) => number;
} {
  const sand = definition.terrain.find((patch) => patch.shape === "disc" && patch.kind === "sand");
  if (sand !== undefined && sand.shape === "disc") {
    const radius = sand.radius + LAGOON_REACH;
    return { center: sand.center, radius, edge: wavyDiscEdge(radius) };
  }
  const bounds = islandBounds(definition);
  return {
    center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    radius: Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2 + LAGOON_REACH,
    edge: () => 0,
  };
}

export function Island(props: {
  readonly definition: WorldDefinition;
  readonly furniture: ReadonlyArray<FurnitureSpot>;
  readonly ripple: boolean;
}) {
  const { definition, furniture, ripple } = props;
  const faded = useContext(FadedContext);
  const shore = useMemo(() => rippleShore(definition), [definition]);
  const ground = groundHeight(definition);
  return (
    <group>
      {ripple ? <Ripple center={shore.center} radius={shore.radius} edge={shore.edge} /> : null}
      {definition.terrain.map((patch) => {
        const top = TERRAIN_TOP[patch.kind];
        return patch.shape === "disc" ? (
          <group
            key={`${patch.kind}:${patch.center.join(",")}:${patch.radius}`}
            position={[patch.center[0], 0, patch.center[1]]}
          >
            <mesh geometry={roundPatchGeometry(patch.kind, patch.radius, top, faded)}>
              <meshLambertMaterial
                vertexColors
                {...(patch.kind === "sand" ? { map: sandGrainTexture() } : {})}
              />
            </mesh>
            {patch.kind === "sand" && !faded ? (
              // Just above the sea, under the island's rim: turquoise, then
              // paler water over the sand close in. Gone on an empty island,
              // where they'd read as rings of darker sea.
              <>
                <mesh geometry={wavyDiscGeometry(patch.radius + LAGOON_REACH)} position-y={-0.24}>
                  <LitMaterial color={palette.lagoon} />
                </mesh>
                <mesh geometry={wavyDiscGeometry(patch.radius + 0.9)} position-y={-0.23}>
                  <LitMaterial color={palette.shallows} />
                </mesh>
              </>
            ) : null}
            {patch.kind === "grass"
              ? // Bands of lighter green toward the middle, each a hair above the last.
                palette.lawnBands.map((color, index) => (
                  <mesh
                    key={color}
                    geometry={wavyDiscGeometry(patch.radius * LAWN_BANDS[index]!)}
                    position-y={top + 0.003 * (index + 1)}
                  >
                    <LitMaterial color={color} />
                  </mesh>
                ))
              : null}
          </group>
        ) : (
          <mesh
            key={`${patch.kind}:${patch.center.join(",")}:${patch.size.join(",")}`}
            geometry={geometry.box}
            position={[patch.center[0], top - TERRAIN_DEPTH / 2, patch.center[1]]}
            scale={[patch.size[0], TERRAIN_DEPTH, patch.size[1]]}
          >
            <LitMaterial color={TERRAIN_COLOR[patch.kind]} />
          </mesh>
        );
      })}
      <GroundShadow geometry={islandShadows(definition, furniture, ground)} />
      <Suspense fallback={null}>
        <Scenery definition={definition} />
      </Suspense>
      {definition.props
        .filter((prop) => !isScenery(prop.kind))
        .map((prop) => (
          <Prop
            key={`${prop.kind}:${prop.position.join(",")}`}
            kind={prop.kind}
            position={prop.position}
            ground={ground}
            facing={prop.facing}
            length={prop.length}
          />
        ))}
      {furniture.map((spot) => (
        <Prop
          key={`${spot.kind}-${spot.position.join(",")}`}
          kind={spot.kind}
          position={spot.position}
          ground={ground}
          facing={spot.facing}
          scale={spot.scale}
        />
      ))}
    </group>
  );
}

/** The island's pebbles and grass tufts, as one mesh. */
function Scenery({ definition }: { readonly definition: WorldDefinition }) {
  const baked = sceneryGeometry(useNatureModels(), definition, useContext(FadedContext));
  const ground = groundHeight(definition);
  if (baked === null) return null;
  return (
    <>
      <mesh geometry={baked}>
        <meshLambertMaterial vertexColors />
      </mesh>
      <GroundShadow geometry={shadowOf(baked, ground)} />
    </>
  );
}

interface Placed {
  readonly kind: PropKind;
  readonly position: Vec3;
  readonly facing: number;
  readonly scale?: number | undefined;
  readonly length?: number | undefined;
}

/** Every prop's shadow on the island, scenery aside, as one mesh. */
function islandShadows(
  definition: WorldDefinition,
  furniture: ReadonlyArray<FurnitureSpot>,
  ground: Ground,
): BufferGeometry | null {
  const casters: Placed[] = [
    ...definition.props.filter((prop) => !isScenery(prop.kind)),
    ...furniture,
  ];
  const key = casters
    .map((prop) => `${prop.kind}:${prop.position.join(",")}:${prop.facing}:${prop.scale ?? 1}`)
    .join("|");
  return castShadows(
    key,
    () =>
      casters.flatMap((prop) => {
        const [x, y, z] = prop.position;
        const frame = chain(
          translate(x, y + ground(x, z), z),
          rotateY(prop.facing),
          scale(prop.scale ?? 1),
        );
        return propParts(prop.kind, prop.length ?? 1, seedOf(prop)).map((part) => ({
          geometry: part.geometry,
          matrix: frame,
        }));
      }),
    ground,
  );
}

function GroundShadow({ geometry: shadow }: { readonly geometry: BufferGeometry | null }) {
  if (shadow === null) return null;
  return (
    // Just above the ground, under the characters' own shadows.
    <mesh geometry={shadow} position-y={0.011} renderOrder={1}>
      <meshBasicMaterial
        color={palette.shadow}
        transparent
        opacity={0.16}
        depthWrite={false}
        side={DoubleSide}
        {...SHADOW_STENCIL}
      />
    </mesh>
  );
}

/** Stable per placement, so props that vary (rock piles, palms) differ from their neighbours. */
const seedOf = (prop: Pick<Placed, "position">) => hashString(prop.position.join(","));

function Prop(props: {
  readonly kind: PropKind;
  readonly position: readonly [number, number, number];
  readonly ground: Ground;
  readonly facing: number;
  readonly scale?: number;
  readonly length?: number | undefined;
}) {
  const [x, y, z] = props.position;
  return (
    <group
      position={[x, y + props.ground(x, z), z]}
      rotation-y={props.facing}
      scale={props.scale ?? 1}
    >
      <MergedMeshes parts={propParts(props.kind, props.length ?? 1, seedOf(props))} />
    </group>
  );
}

/**
 * A prop's pieces, merged by colour. Each is built around its slot: local +z
 * is the way the occupant faces, and the thing they work at stands in front
 * of them. Long props (the pier) run `length` units along +z.
 */
function propParts(kind: PropKind, length: number, seed: number): ReadonlyArray<MergedPart> {
  switch (kind) {
    case "rockPile":
      return mergedParts(`rocks:${seed}`, () => pileParts(seed));
    case "towel":
      return mergedParts("towel", towelParts);
    case "beachChair":
      return mergedParts("beachChair", loungerParts);
    case "pier":
      return mergedParts(`pier:${length}`, () => pierParts(length));
    case "palm":
      return mergedParts(`palm:${seed % 70}`, () => palmParts(seed));
    case "tree":
      return mergedParts("tree", treeParts);
    case "rock":
    case "grass":
      // Drawn together with the rest of the island's scenery; see `Scenery`.
      return [];
  }
}

function treeParts(): Part[] {
  return [
    {
      geometry: geometry.cylinder,
      matrix: chain(translate(0, 0.35, 0), scale(0.12, 0.7, 0.12)),
      color: palette.treeTrunk,
    },
    {
      geometry: geometry.foliage,
      matrix: chain(translate(0, 1.25, 0), scale(0.75)),
      color: palette.treeLeaf,
      flat: true,
    },
  ];
}

/** One family's pile, in front of the parent; its kids mine it from the sides. */
function pileParts(seed: number): Part[] {
  const frame = chain(translate(0, 0, 0.95), rotateY((seed % 360) * (Math.PI / 180)), scale(0.55));
  return rockPile(seed).map((rock) => ({
    geometry: geometry.foliage,
    matrix: chain(
      frame,
      translate(...rock.position),
      rotateX(rock.rotation[0]),
      rotateY(rock.rotation[1]),
      scale(...rock.scale),
    ),
    color: rock.color,
    flat: true,
  }));
}

const PALM_SEGMENTS = 7;
const PALM_FRONDS = 8;

/**
 * A coconut palm: a ringed trunk curving away from upright, a crown of
 * drooping two-part fronds and a cluster of coconuts. Height and bend come
 * from the seed; the prop's facing sets which way it leans.
 */
function palmParts(seed: number): Part[] {
  const height = 2.3 + (seed % 7) * 0.12;
  const bend = 0.45 + (seed % 5) * 0.1;
  const segment = height / PALM_SEGMENTS;
  // The trunk follows x = bend * t², so it leans more toward the top.
  const at = (t: number) => bend * t * t;
  const parts: Part[] = [];
  for (let index = 0; index < PALM_SEGMENTS; index += 1) {
    const t = (index + 0.5) / PALM_SEGMENTS;
    const radius = 0.15 - t * 0.06;
    parts.push({
      geometry: geometry.cylinder,
      matrix: chain(
        translate(at(t), (index + 0.5) * segment, 0),
        rotateZ(-Math.atan((2 * bend * t) / height)),
        scale(radius, segment * 1.04, radius),
      ),
      color: index % 2 === 0 ? palette.palmTrunk : palette.palmTrunkDark,
    });
  }
  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2 + 0.4;
    parts.push({
      geometry: geometry.puff,
      matrix: translate(at(1) + Math.cos(angle) * 0.13, height - 0.12, Math.sin(angle) * 0.13),
      color: palette.coconut,
    });
  }
  for (let index = 0; index < PALM_FRONDS; index += 1) {
    const color = index % 2 === 0 ? palette.palmLeaf : palette.palmLeafDark;
    // Rising from the crown, then drooping toward the tip.
    const frond = chain(
      translate(at(1), height, 0),
      rotateY((index / PALM_FRONDS) * Math.PI * 2 + (seed % 10) * 0.07),
      rotateZ(index % 2 === 0 ? 0.4 : 0.2),
    );
    parts.push({
      geometry: geometry.box,
      matrix: chain(frond, translate(0.42, 0, 0), scale(0.85, 0.04, 0.34)),
      color,
    });
    parts.push({
      geometry: geometry.box,
      matrix: chain(
        frond,
        translate(0.82, 0, 0),
        rotateZ(-0.85),
        translate(0.36, 0, 0),
        scale(0.75, 0.035, 0.24),
      ),
      color,
    });
  }
  return parts;
}

/** A box of `size` centred at `at`, inside `frame`. */
const block = (
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  color: string,
  frame = new Matrix4(),
): Part => ({
  geometry: geometry.box,
  matrix: chain(frame, translate(...at), scale(...size)),
  color,
});

/** Long enough for a lying agent, head end (-z) included. */
function towelParts(): Part[] {
  const frame = translate(0, 0, -0.3);
  return [
    block([0.8, 0.03, 1.9], [0, 0.015, 0], palette.towel, frame),
    block([0.82, 0.032, 0.3], [0, 0.016, -0.5], palette.towelStripe, frame),
    block([0.82, 0.032, 0.3], [0, 0.016, 0.45], palette.towelStripe, frame),
  ];
}

/** A lounger: feet toward the sea (+z), backrest raised behind. */
function loungerParts(): Part[] {
  const backrest = chain(translate(0, 0.34, -0.33), rotateX(0.95));
  return [
    ...[-0.26, 0.26].flatMap((x) =>
      [-0.3, 0.7].map((z) => block([0.05, 0.3, 0.05], [x, 0.15, z], palette.chairFrame)),
    ),
    block([0.62, 0.05, 1.1], [0, 0.32, 0.2], palette.chairFrame),
    block([0.54, 0.06, 1.04], [0, 0.37, 0.2], palette.chairCushion),
    block([0.62, 0.05, 0.7], [0, 0, -0.35], palette.chairFrame, backrest),
    block([0.54, 0.06, 0.66], [0, 0.05, -0.35], palette.chairCushion, backrest),
  ];
}

const PIER_WIDTH = 1.8;

/**
 * A plank deck running `length` units along +z, its top just above the sand,
 * on posts where it stands over the water.
 */
function pierParts(length: number): Part[] {
  const planks = Math.round(length / 0.32);
  const pitch = length / planks;
  const parts: Part[] = Array.from({ length: planks }, (_, index) =>
    block(
      [PIER_WIDTH, 0.08, pitch - 0.04],
      [0, -0.02, (index + 0.5) * pitch],
      index % 2 === 0 ? palette.plank : palette.plankDark,
    ),
  );
  // Rails along both sides tie the planks together.
  const edge = PIER_WIDTH / 2 - 0.05;
  for (const x of [-edge, edge]) {
    parts.push(block([0.1, 0.1, length], [x, -0.08, length / 2], palette.plankDark));
  }
  // Posts only past the first stretch, which lies on the sand.
  for (let z = 1.4; z < length; z += 1.5) {
    for (const x of [-edge, edge]) {
      parts.push({
        geometry: geometry.cylinder,
        matrix: chain(translate(x, -0.45, z), scale(0.08, 0.8, 0.08)),
        color: palette.plankDark,
      });
    }
  }
  return parts;
}

function MergedMeshes(props: { readonly parts: ReadonlyArray<MergedPart> }) {
  return props.parts.map((part) => (
    <mesh key={`${part.color}:${part.flat}`} geometry={part.geometry}>
      <LitMaterial color={part.color} flatShading={part.flat} />
    </mesh>
  ));
}

interface PileRock {
  readonly key: number;
  readonly position: [number, number, number];
  readonly rotation: [number, number, number];
  readonly scale: [number, number, number];
  readonly color: string;
}

const ROCK_TONES = [palette.stone, palette.stoneDark, palette.stoneLight];

/**
 * A pile of 4 to 6 rocks around a big one, drawn from the seed: every pile on
 * an island has its own shape and mix of greys, and the same pile looks the
 * same on every visit. Greys only, so piles never compete with characters.
 */
function rockPile(seed: number): PileRock[] {
  let state = seed || 1;
  const random = () => {
    // xorshift32: cheap, stable across platforms.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const core = 0.7 + random() * 0.35;
  const rocks: PileRock[] = [
    {
      key: 0,
      position: [0, core * 0.55, 0],
      rotation: [random() * 3, random() * 3, 0],
      scale: [core, core * (0.7 + random() * 0.5), core],
      color: ROCK_TONES[Math.floor(random() * ROCK_TONES.length)]!,
    },
  ];
  const count = 4 + Math.floor(random() * 3);
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + random() * 0.6;
    const distance = 0.55 + random() * 0.3;
    const size = 0.3 + random() * 0.3;
    rocks.push({
      key: index + 1,
      position: [Math.cos(angle) * distance, size * 0.5, Math.sin(angle) * distance],
      rotation: [random() * 3, random() * 3, 0],
      scale: [size, size * (0.6 + random() * 0.5), size],
      color: ROCK_TONES[Math.floor(random() * ROCK_TONES.length)]!,
    });
  }
  return rocks;
}
