import type { PropKind, TerrainKind, Vec3, WorldDefinition } from "../definition/types";
import { islandBounds } from "../engine/archipelago";
import { hashString } from "../engine/hash";
import { geometry } from "./geometries";
import { LitMaterial } from "./lighting";
import { palette } from "./palette";
import { Campfire, NightWater } from "./Night";
import { Ripple } from "./Ripple";

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

export function Island(props: {
  readonly definition: WorldDefinition;
  readonly furniture: ReadonlyArray<FurnitureSpot>;
  readonly ripple: boolean;
  readonly night: boolean;
}) {
  const { definition, furniture, ripple, night } = props;
  const bounds = islandBounds(definition);
  const center: [number, number] = [
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minZ + bounds.maxZ) / 2,
  ];
  const radius = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
  return (
    <group>
      {ripple ? <Ripple center={center} radius={radius + 0.3} /> : null}
      {night ? (
        <>
          <NightWater center={center} radius={radius + 4} />
          <Campfire position={definition.archipelago.night.campfire} />
        </>
      ) : null}
      {definition.terrain.map((patch) => {
        const style = TERRAIN[patch.kind];
        const y = style.top - TERRAIN_DEPTH / 2;
        return patch.shape === "disc" ? (
          <mesh
            key={`${patch.kind}:${patch.center.join(",")}:${patch.radius}`}
            geometry={geometry.disc}
            position={[patch.center[0], y, patch.center[1]]}
            scale={[patch.radius, TERRAIN_DEPTH, patch.radius]}
          >
            <LitMaterial color={style.color} />
          </mesh>
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
 * and the thing they work at stands in front of them. Long props (pier, rope)
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
    case "pier":
      return (
        <>
          <Block size={[1.3, 0.1, length]} at={[0, -0.05, length / 2]} color={palette.plank} />
          {/* Posts only where the deck is over water, past the first stretch on the sand. */}
          {Array.from({ length: Math.floor((length - 1.2) / 1.6) + 1 }, (_, index) =>
            [-0.6, 0.6].map((x) => (
              <Cylinder
                key={`${index}:${x}`}
                radius={0.07}
                height={0.8}
                at={[x, -0.35, Math.min(length - 0.1, 1.4 + index * 1.6)]}
                color={palette.woodDark}
              />
            )),
          )}
        </>
      );
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
          {rockPile(seed).map((rock) => (
            <mesh
              key={rock.key}
              geometry={geometry.foliage}
              position={rock.position}
              rotation={rock.rotation}
              scale={rock.scale}
            >
              <LitMaterial color={rock.color} flatShading />
            </mesh>
          ))}
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
    case "beachChair":
      return (
        <group rotation-x={-0.12}>
          <Block size={[0.55, 0.05, 1.3]} at={[0, 0.26, 0]} color={palette.towel} />
          <Block size={[0.57, 0.052, 0.26]} at={[0, 0.262, -0.3]} color={palette.towelStripe} />
          <Block size={[0.57, 0.052, 0.26]} at={[0, 0.262, 0.25]} color={palette.towelStripe} />
        </group>
      );
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
      return (
        <>
          <group rotation-z={0.12}>
            <Cylinder radius={0.1} height={2.4} at={[0, 1.2, 0]} color={palette.palmTrunk} />
          </group>
          {[0, 1, 2, 3, 4].map((index) => (
            <group key={index} position={[-0.28, 2.35, 0]} rotation-y={(index * Math.PI * 2) / 5}>
              <mesh
                geometry={geometry.box}
                position-x={0.5}
                rotation-z={-0.35}
                scale={[1.1, 0.04, 0.3]}
              >
                <LitMaterial color={palette.palmLeaf} />
              </mesh>
            </group>
          ))}
        </>
      );
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
