import { useContext, useMemo } from "react";
import { type BufferGeometry, Matrix4 } from "three";

import type { PropKind, TerrainKind, Vec3, WorldDefinition } from "../definition/types";
import { islandBounds } from "../engine/archipelago";
import { hashString } from "../engine/hash";
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
import { palette } from "./palette";
import { Ripple } from "./Ripple";
import { propShadows } from "./shadows";
import { roundPatchGeometry, shallowsEdge, shallowsGeometry } from "./terrain";

const TERRAIN: Record<TerrainKind, { readonly color: string; readonly top: number }> = {
  // Stacked a hair apart so overlapping patches never z-fight.
  sand: { color: palette.sand, top: 0 },
  grass: { color: palette.grass, top: 0.01 },
  path: { color: palette.path, top: 0.02 },
};
const TERRAIN_DEPTH = 0.6;

export interface FurnitureSpot {
  readonly kind: PropKind;
  readonly position: Vec3;
  readonly facing: number;
  readonly scale: number;
}

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
    return { center: sand.center, radius, edge: shallowsEdge(radius) };
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
  return (
    <group>
      {ripple ? <Ripple center={shore.center} radius={shore.radius} edge={shore.edge} /> : null}
      {definition.terrain.map((patch) => {
        const style = TERRAIN[patch.kind];
        const y = style.top - TERRAIN_DEPTH / 2;
        return patch.shape === "disc" ? (
          <group
            key={`${patch.kind}:${patch.center.join(",")}:${patch.radius}`}
            position={[patch.center[0], 0, patch.center[1]]}
          >
            <mesh geometry={roundPatchGeometry(patch.kind, patch.radius, style.top, faded)}>
              <meshLambertMaterial vertexColors />
            </mesh>
            {patch.kind === "sand" && !faded ? (
              // Just above the sea, under the island's rim: turquoise, then
              // paler water over the sand close in. Gone on an empty island,
              // where they'd read as rings of darker sea.
              <>
                <mesh geometry={shallowsGeometry(patch.radius + LAGOON_REACH)} position-y={-0.24}>
                  <LitMaterial color={palette.lagoon} />
                </mesh>
                <mesh geometry={shallowsGeometry(patch.radius + 0.9)} position-y={-0.23}>
                  <LitMaterial color={palette.shallows} />
                </mesh>
              </>
            ) : null}
          </group>
        ) : (
          <mesh
            key={`${patch.kind}:${patch.center.join(",")}:${patch.size.join(",")}`}
            geometry={geometry.box}
            position={[patch.center[0], y, patch.center[1]]}
            scale={[patch.size[0], TERRAIN_DEPTH, patch.size[1]]}
          >
            <LitMaterial color={style.color} />
          </mesh>
        );
      })}
      <PropShadows geometry={propShadows([...definition.props, ...furniture])} />
      {definition.props.map((prop) => (
        <Prop
          key={`${prop.kind}:${prop.position.join(",")}`}
          kind={prop.kind}
          position={prop.position}
          facing={prop.facing}
          length={prop.length}
        />
      ))}
      {furniture.map((spot) => (
        <Prop
          key={`${spot.kind}-${spot.position.join(",")}`}
          kind={spot.kind}
          position={spot.position}
          facing={spot.facing}
          scale={spot.scale}
        />
      ))}
    </group>
  );
}

function PropShadows({ geometry: shadows }: { readonly geometry: BufferGeometry | null }) {
  if (shadows === null) return null;
  return (
    // On the lawn, just under the characters' own shadows.
    <mesh geometry={shadows} position-y={0.011} renderOrder={1}>
      <meshBasicMaterial color={palette.shadow} transparent opacity={0.14} depthWrite={false} />
    </mesh>
  );
}

function Prop(props: {
  readonly kind: PropKind;
  readonly position: readonly [number, number, number];
  readonly facing: number;
  readonly scale?: number;
  readonly length?: number | undefined;
}) {
  return (
    <group
      position={props.position as [number, number, number]}
      rotation-y={props.facing}
      scale={props.scale ?? 1}
    >
      <PropModel
        kind={props.kind}
        length={props.length ?? 1}
        seed={hashString(props.position.join(","))}
      />
    </group>
  );
}

/**
 * Each model is built around its slot: local +z is the way the occupant faces,
 * and the thing they work at stands in front of them. Long props (rope)
 * run `length` units along +z.
 */
function PropModel({
  kind,
  length,
  seed,
}: {
  readonly kind: PropKind;
  readonly length: number;
  /** Stable per placement, so props that vary (rock piles) differ from their neighbours. */
  readonly seed: number;
}) {
  switch (kind) {
    case "raft":
      return (
        <>
          {[-0.6, -0.3, 0, 0.3, 0.6].map((x) => (
            <mesh
              key={x}
              geometry={geometry.cylinder}
              position={[x, 0, 0]}
              rotation-x={Math.PI / 2}
              scale={[0.15, 2.6, 0.15]}
            >
              <LitMaterial color={palette.log} />
            </mesh>
          ))}
          <Block size={[1.6, 0.06, 0.12]} at={[0, 0.13, -1]} color={palette.rope} />
          <Block size={[1.6, 0.06, 0.12]} at={[0, 0.13, 1]} color={palette.rope} />
        </>
      );
    case "rockPile":
      // One family's pile, in front of the parent; its kids mine it from the sides.
      return (
        <group position-z={0.95} scale={0.55} rotation-y={(seed % 360) * (Math.PI / 180)}>
          <MergedMeshes
            parts={mergedParts(`rocks:${seed}`, () =>
              rockPile(seed).map((rock) => ({
                geometry: geometry.foliage,
                matrix: chain(
                  translate(...rock.position),
                  rotateX(rock.rotation[0]),
                  rotateY(rock.rotation[1]),
                  scale(...rock.scale),
                ),
                color: rock.color,
              })),
            )}
            flatShading
          />
        </group>
      );
    case "rope":
      return (
        <mesh
          geometry={geometry.cylinder}
          position={[0, 0, length / 2]}
          rotation-x={Math.PI / 2}
          scale={[0.03, length, 0.03]}
        >
          <LitMaterial color={palette.rope} />
        </mesh>
      );
    case "towel":
      return <MergedMeshes parts={mergedParts("towel", towelParts)} />;
    case "beachChair":
      return <MergedMeshes parts={mergedParts("beachChair", loungerParts)} />;
    case "umbrella":
      return (
        <>
          <Cylinder radius={0.03} height={2} at={[0, 1, 0]} color={palette.pole} />
          <mesh geometry={geometry.cone} position-y={2.1} scale={[1.1, 0.45, 1.1]}>
            <LitMaterial color={palette.canopy} />
          </mesh>
        </>
      );
    case "palm":
      return <Palm seed={seed} />;
    case "tree":
      return (
        <>
          <Cylinder radius={0.12} height={0.7} at={[0, 0.35, 0]} color={palette.treeTrunk} />
          <mesh geometry={geometry.foliage} position-y={1.25} scale={0.75}>
            <LitMaterial color={palette.treeLeaf} flatShading />
          </mesh>
        </>
      );
  }
}

const PALM_SEGMENTS = 7;
const PALM_FRONDS = 8;

/**
 * A coconut palm: a ringed trunk curving away from upright, a crown of
 * drooping two-part fronds and a cluster of coconuts. Height and bend come
 * from the seed; the prop's facing sets which way it leans.
 */
function Palm({ seed }: { readonly seed: number }) {
  return <MergedMeshes parts={mergedParts(`palm:${seed % 70}`, () => palmParts(seed))} />;
}

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

function MergedMeshes(props: {
  readonly parts: ReadonlyArray<MergedPart>;
  readonly flatShading?: boolean;
}) {
  return props.parts.map((part) => (
    <mesh key={part.color} geometry={part.geometry}>
      <LitMaterial color={part.color} flatShading={props.flatShading ?? false} />
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

function Block(props: {
  readonly size: readonly [number, number, number];
  readonly at: readonly [number, number, number];
  readonly color: string;
}) {
  return (
    <mesh
      geometry={geometry.box}
      position={props.at as [number, number, number]}
      scale={props.size as [number, number, number]}
    >
      <LitMaterial color={props.color} />
    </mesh>
  );
}

function Cylinder(props: {
  readonly radius: number;
  readonly height: number;
  readonly at: readonly [number, number, number];
  readonly color: string;
}) {
  return (
    <mesh
      geometry={geometry.cylinder}
      position={props.at as [number, number, number]}
      scale={[props.radius, props.height, props.radius]}
    >
      <LitMaterial color={props.color} />
    </mesh>
  );
}
