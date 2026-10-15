import { Suspense, useContext, useMemo } from "react";
import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  SRGBColorSpace,
  Vector3,
} from "three";

import type { PropKind, TerrainKind, Vec3, WorldDefinition } from "../definition/types";
import { islandBounds } from "../engine/archipelago";
import { hashString, seededRandom } from "../engine/hash";
import { isScenery } from "../engine/scenery";
import { geometry } from "./geometries";
import type { Direction } from "./daylight";
import { Lamp } from "./Lamp";
import { FadedContext, LitMaterial, TimeOfDayContext, toFaded } from "./lighting";
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
  shoreFoamGeometry,
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

/**
 * Water round an empty island: in its sea shades like the rest of it, `lift`
 * lighter, so it still reads as water around the dimmed sand.
 */
function idleWater(color: string, lift: number): string {
  const shade = new Color(toFaded(color)).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
  return `#${new Color().setHSL(shade.h, shade.s, shade.l + lift, SRGBColorSpace).getHexString()}`;
}
const IDLE_SHALLOWS = idleWater(palette.shallows, 0.06);
const IDLE_FOAM = idleWater(palette.foam, 0.2);

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
  const { light } = useContext(TimeOfDayContext);
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
            {patch.kind === "sand" ? (
              // Just above the sea, under the island's rim: turquoise, then
              // paler water over the sand close in. Water, not island, so it
              // keeps its colours on an empty island too.
              <FadedContext value={false}>
                <mesh geometry={wavyDiscGeometry(patch.radius + LAGOON_REACH)} position-y={-0.24}>
                  <LitMaterial color={palette.lagoon} />
                </mesh>
                <mesh geometry={wavyDiscGeometry(patch.radius + 0.9)} position-y={-0.23}>
                  <LitMaterial color={faded ? IDLE_SHALLOWS : palette.shallows} />
                </mesh>
                {/* Surf where the sand meets the water, over the shallows. */}
                <mesh geometry={shoreFoamGeometry(patch.radius)} position-y={-0.225}>
                  <LitMaterial color={faded ? IDLE_FOAM : palette.foam} />
                </mesh>
              </FadedContext>
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
      <GroundShadow geometry={islandShadows(definition, furniture, ground, light)} />
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
            seed={seedOf(prop, definition)}
            ground={ground}
            facing={prop.facing}
            scale={prop.scale}
            length={prop.length}
          />
        ))}
      {furniture.map((spot) => (
        <Prop
          key={`${spot.kind}-${spot.position.join(",")}`}
          kind={spot.kind}
          position={spot.position}
          seed={seedOf(spot, definition)}
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
  const { light } = useContext(TimeOfDayContext);
  const ground = groundHeight(definition);
  if (baked === null) return null;
  return (
    <>
      <mesh geometry={baked}>
        <meshLambertMaterial vertexColors />
      </mesh>
      <GroundShadow geometry={shadowOf(baked, light, ground)} />
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

/**
 * Every prop's shadow on the island, as one mesh. Scenery casts its own, and
 * lamps none: they sink into the ground by day.
 */
function islandShadows(
  definition: WorldDefinition,
  furniture: ReadonlyArray<FurnitureSpot>,
  ground: Ground,
  light: Direction,
): BufferGeometry | null {
  const casters: Placed[] = [
    ...definition.props.filter((prop) => !isScenery(prop.kind) && prop.kind !== "lamp"),
    ...furniture,
  ];
  const key = `${definition.seed ?? ""}|${casters
    .map((prop) => `${prop.kind}:${prop.position.join(",")}:${prop.facing}:${prop.scale ?? 1}`)
    .join("|")}`;
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
        return propParts(prop.kind, prop.length ?? 1, seedOf(prop, definition)).map((part) => ({
          geometry: part.geometry,
          matrix: frame,
        }));
      }),
    light,
    ground,
  );
}

function GroundShadow({ geometry: shadow }: { readonly geometry: BufferGeometry | null }) {
  const { shadowOpacity } = useContext(TimeOfDayContext);
  if (shadow === null) return null;
  return (
    // Just above the ground, under the characters' own shadows.
    <mesh geometry={shadow} position-y={0.011} renderOrder={1}>
      <meshBasicMaterial
        color={palette.shadow}
        transparent
        opacity={shadowOpacity}
        depthWrite={false}
        side={DoubleSide}
        {...SHADOW_STENCIL}
      />
    </mesh>
  );
}

/**
 * Stable per placement, so props that vary (rock piles, palms) differ from
 * their neighbours, and per island (see `WorldDefinition.seed`).
 */
const seedOf = (prop: Pick<Placed, "position">, definition: WorldDefinition) =>
  hashString(`${definition.seed ?? ""}:${prop.position.join(",")}`);

function Prop(props: {
  readonly kind: PropKind;
  readonly position: readonly [number, number, number];
  /** From `seedOf`. */
  readonly seed: number;
  readonly ground: Ground;
  readonly facing: number;
  readonly scale?: number | undefined;
  readonly length?: number | undefined;
}) {
  const [x, y, z] = props.position;
  return (
    <group
      position={[x, y + props.ground(x, z), z]}
      rotation-y={props.facing}
      scale={props.scale ?? 1}
    >
      {props.kind === "lamp" ? (
        <Lamp seed={props.seed} />
      ) : (
        <MergedMeshes parts={propParts(props.kind, props.length ?? 1, props.seed)} />
      )}
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
      return mergedParts(`palm:${seed % 70}`, () => palmParts(seed % 70));
    case "tree":
      return mergedParts(`tree:${seed % 30}`, () => treeParts(seed % 30));
    case "boulder":
      return mergedParts(`boulder:${seed % 20}`, () => boulderParts(seed % 20));
    case "sibipiruna":
      return mergedParts(`sibipiruna:${seed % 12}`, () => sibipirunaParts(seed % 12));
    case "lamp":
      // Drawn by `Lamp`, which raises and lowers it.
      return [];
    case "rock":
    case "grass":
      // Drawn together with the rest of the island's scenery; see `Scenery`.
      return [];
  }
}

/**
 * A lumpy, faceted crown of leaves: a twice-split icosahedron with every
 * corner pushed in or out a little. Corners are moved by where they sit, so
 * faces that share one stay joined.
 */
const canopy = (() => {
  const shape = new IcosahedronGeometry(1, 1);
  const position = shape.getAttribute("position");
  const corner = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    corner.fromBufferAttribute(position, index);
    const at = [corner.x, corner.y, corner.z].map((value) => Math.round(value * 1000));
    corner.multiplyScalar(0.86 + (hashString(at.join(",")) % 1000) * 0.00028);
    position.setXYZ(index, corner.x, corner.y, corner.z);
  }
  shape.computeVertexNormals();
  return shape;
})();

/**
 * A low-poly tree in one of three shapes, picked by the seed: one round
 * crown, a crown with two smaller ones on side branches, or a tall lumpy one.
 * A tapered trunk holds it up, and the seed turns and stretches each crown.
 */
function treeParts(seed: number): Part[] {
  const random = seededRandom(hashString(`tree:${seed}`));
  const shape = seed % 3;
  const trunkHeight = shape === 2 ? 1.75 : 1.55;
  const parts: Part[] = [
    {
      geometry: trunkSegment,
      matrix: chain(
        translate(0, trunkHeight / 2, 0),
        rotateY(random() * Math.PI),
        scale(0.12, trunkHeight, 0.12),
      ),
      color: palette.treeTrunk,
      flat: true,
    },
  ];
  /** A thin branch leaning `tilt` off upright toward `heading`; returns where its tip ends. */
  const branch = (heading: number, tilt: number, length: number, from: number): Vec3 => {
    parts.push({
      geometry: trunkSegment,
      matrix: chain(
        translate(0, from, 0),
        rotateY(heading),
        rotateZ(-tilt),
        translate(0, length / 2, 0),
        scale(0.045, length, 0.045),
      ),
      color: palette.treeTrunk,
      flat: true,
    });
    const reach = Math.sin(tilt) * length;
    return [Math.cos(heading) * reach, from + Math.cos(tilt) * length, -Math.sin(heading) * reach];
  };
  /** A crown of leaves. */
  const crown = (x: number, y: number, z: number, size: number, stretch = 1) => {
    const leaves = chain(
      translate(x, y, z),
      rotateY(random() * Math.PI * 2),
      rotateX((random() - 0.5) * 0.6),
      scale(size, size * stretch * (0.85 + random() * 0.2), size),
    );
    parts.push({ geometry: canopy, matrix: leaves, color: palette.treeLeaf, flat: true });
  };
  if (shape === 0) {
    crown(0, trunkHeight + 0.5, 0, 0.82);
    // A bare twig poking out under the crown.
    branch(random() * Math.PI * 2, 0.9, 0.45, trunkHeight * 0.55);
  } else if (shape === 1) {
    crown(0, trunkHeight + 0.4, 0, 0.6);
    const heading = random() * Math.PI;
    for (const side of [0, Math.PI]) {
      const [x, y, z] = branch(heading + side, 0.9, 0.75, trunkHeight * 0.6);
      crown(x, y + 0.05, z, 0.38);
    }
  } else {
    crown(0, trunkHeight + 0.75, 0, 0.55, 1.6);
    crown(0.18, trunkHeight + 1.35, 0.05, 0.4, 1.3);
  }
  return parts;
}

/**
 * A low-poly sibipiruna: a trunk that forks low into long limbs, each with a
 * twig of its own, reaching up and out to hold a broad, flat-topped crown of
 * leafy lobes. The lobes sit above the limbs' tips, so the branches show
 * under the crown. The seed turns the fork and sizes the lobes.
 */
function sibipirunaParts(seed: number): Part[] {
  const random = seededRandom(hashString(`sibipiruna:${seed}`));
  const fork = 1.05;
  const lean = (random() - 0.5) * 0.16;
  const parts: Part[] = [
    {
      geometry: trunkSegment,
      matrix: chain(
        rotateZ(lean),
        translate(0, fork / 2, 0),
        rotateY(random() * Math.PI),
        scale(0.16, fork, 0.16),
      ),
      color: palette.treeTrunk,
      flat: true,
    },
  ];
  const top: Vec3 = [-Math.sin(lean) * fork, Math.cos(lean) * fork, 0];
  /** A branch from `from`, leaning `tilt` off upright toward `heading`; returns its tip. */
  const branch = (from: Vec3, heading: number, tilt: number, length: number, width: number) => {
    parts.push({
      geometry: trunkSegment,
      matrix: chain(
        translate(...from),
        rotateY(heading),
        rotateZ(-tilt),
        translate(0, length / 2, 0),
        scale(width, length, width),
      ),
      color: palette.treeTrunk,
      flat: true,
    });
    const reach = Math.sin(tilt) * length;
    return [
      from[0] + Math.cos(heading) * reach,
      from[1] + Math.cos(tilt) * length,
      from[2] - Math.sin(heading) * reach,
    ] as const;
  };
  /** A crown lobe, a squashed canopy. */
  const lobe = (center: Vec3, size: number, color: string) => {
    parts.push({
      geometry: canopy,
      matrix: chain(
        translate(...center),
        rotateY(random() * Math.PI * 2),
        scale(size, size * (0.5 + random() * 0.12), size),
      ),
      color,
      flat: true,
    });
  };
  const limbs = 4;
  const turn = random() * Math.PI * 2;
  let highest = 0;
  for (let index = 0; index < limbs; index += 1) {
    const heading = turn + (index / limbs) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const length = 1.4 + random() * 0.3;
    const tip = branch(top, heading, 0.75 + random() * 0.15, length, 0.09);
    highest = Math.max(highest, tip[1]);
    // A thinner twig off the limb's middle, splaying to one side.
    const middle: Vec3 = [(top[0] + tip[0]) / 2, (top[1] + tip[1]) / 2, (top[2] + tip[2]) / 2];
    const side = (index % 2 === 0 ? 1 : -1) * (0.6 + random() * 0.3);
    branch(middle, heading + side, 0.85, 0.75, 0.05);
    // Resting on the limb's tip, so the limb shows below it.
    lobe(
      [tip[0], tip[1] + 0.32, tip[2]],
      0.58 + random() * 0.14,
      index % 2 === 0 ? palette.treeLeaf : palette.palmLeafDark,
    );
  }
  // The middle of the crown rides over the limbs, a little higher; the camera
  // looks down on the tree, so the gaps between it and the outer lobes show the limbs.
  lobe([top[0], highest + 0.7, top[2]], 0.72, palette.treeLeaf);
  return parts;
}

/**
 * A craggy rock: a split icosahedron with its corners pushed in and out a
 * lot, so no two sides look alike. Corners move by where they sit, so faces
 * that share one stay joined.
 */
const crag = (() => {
  const shape = new IcosahedronGeometry(1, 1);
  const position = shape.getAttribute("position");
  const corner = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    corner.fromBufferAttribute(position, index);
    const at = [corner.x, corner.y, corner.z].map((value) => Math.round(value * 1000));
    corner.multiplyScalar(0.72 + (hashString(`crag:${at.join(",")}`) % 1000) * 0.00056);
    position.setXYZ(index, corner.x, corner.y, corner.z);
  }
  shape.computeVertexNormals();
  return shape;
})();

/**
 * A big craggy rock at the waterline, sunk partway into the sand and the
 * sea, with a few small stones strewn round it. The seed sets its size,
 * shape and where the stones fall, so no two look alike.
 */
function boulderParts(seed: number): Part[] {
  const random = seededRandom(hashString(`boulder:${seed}`));
  const stones = [palette.stone, palette.stoneDark, palette.stoneLight];
  const size = 1 + random() * 0.5;
  const parts: Part[] = [
    {
      geometry: crag,
      matrix: chain(
        translate(0, size * 0.15, 0),
        rotateY(random() * Math.PI * 2),
        rotateZ((random() - 0.5) * 0.5),
        scale(size * (1 + random() * 0.4), size * (0.65 + random() * 0.35), size * 0.85),
      ),
      color: stones[seed % stones.length]!,
      flat: true,
    },
  ];
  const strewn = 1 + Math.floor(random() * 3);
  for (let index = 0; index < strewn; index += 1) {
    const around = random() * Math.PI * 2;
    const away = size * (1 + random() * 0.4);
    const small = 0.25 + random() * 0.35;
    parts.push({
      geometry: geometry.foliage,
      matrix: chain(
        translate(Math.cos(around) * away, small * 0.2, Math.sin(around) * away),
        rotateY(random() * Math.PI * 2),
        rotateX((random() - 0.5) * 0.8),
        scale(small * (0.9 + random() * 0.4), small * (0.6 + random() * 0.3), small),
      ),
      color: stones[(seed + index + 1) % stones.length]!,
      flat: true,
    });
  }
  return parts;
}

/** One family's pile, in front of the parent; its kids mine it from the sides. */
function pileParts(seed: number): Part[] {
  const frame = chain(translate(0, 0, 0.95), rotateY((seed % 360) * (Math.PI / 180)), scale(0.64));
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

const PALM_SEGMENTS = 8;
const PALM_FRONDS = 9;

/** A trunk piece: six-sided and narrower at the top, so stacked ones step in like rings. */
const trunkSegment = new CylinderGeometry(0.72, 1, 1, 6);

/**
 * One palm frond, a unit long along +x: a blade folded down from its midrib,
 * widest a third of the way out and tapering to a point, rising from the
 * crown and drooping toward the tip. Drawn on both sides, since the camera
 * sees under the drooping ones.
 */
const palmFrond = (() => {
  const stations: ReadonlyArray<readonly [x: number, width: number]> = [
    [0, 0.02],
    [0.18, 0.13],
    [0.4, 0.15],
    [0.65, 0.11],
    [0.85, 0.06],
    [1, 0],
  ];
  const positions: number[] = [];
  for (const [x, width] of stations) {
    const y = 0.4 * x - 0.8 * x * x;
    // Edge, midrib, edge: the edges hang below the midrib, folding the blade.
    positions.push(x, y - width * 0.5, -width, x, y, 0, x, y - width * 0.5, width);
  }
  const front: number[] = [];
  for (let index = 0; index + 1 < stations.length; index += 1) {
    const [a, b] = [index * 3, (index + 1) * 3];
    front.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const back = front.map((_, index) => front[front.length - 1 - index]!);
  const frond = new BufferGeometry();
  frond.setAttribute("position", new Float32BufferAttribute(positions, 3));
  frond.setIndex([...front, ...back]);
  frond.computeVertexNormals();
  return frond;
})();

/**
 * A low-poly coconut palm: a trunk of stacked, faceted segments curving away
 * from upright, a cluster of coconuts and a crown of folded fronds, some
 * reaching up and some drooping. Shape comes from the seed; the prop's
 * facing sets which way it leans.
 */
function palmParts(seed: number): Part[] {
  const random = seededRandom(hashString(`palm:${seed}`));
  const height = 2.4 + random() * 0.9;
  const bend = 0.3 + random() * 0.45;
  const segment = height / PALM_SEGMENTS;
  // The trunk follows x = bend * t², so it leans more toward the top.
  const at = (t: number) => bend * t * t;
  const parts: Part[] = [];
  for (let index = 0; index < PALM_SEGMENTS; index += 1) {
    const t = (index + 0.5) / PALM_SEGMENTS;
    // A flared foot, then a steady taper.
    const radius = (index === 0 ? 0.2 : 0.16) - t * 0.06;
    parts.push({
      geometry: trunkSegment,
      matrix: chain(
        translate(at(t), (index + 0.5) * segment, 0),
        rotateZ(-Math.atan((2 * bend * t) / height)),
        // Each segment turned a little, so the facets don't line up.
        rotateY(random() * Math.PI),
        scale(radius, segment * 1.08, radius),
      ),
      color: index % 2 === 0 ? palette.palmTrunk : palette.palmTrunkDark,
      flat: true,
    });
  }
  const crown = translate(at(1), height, 0);
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2 + random();
    parts.push({
      geometry: geometry.foliage,
      matrix: chain(
        crown,
        translate(Math.cos(angle) * 0.12, -0.13 - (index % 2) * 0.05, Math.sin(angle) * 0.12),
        rotateX(random() * 3),
        scale(0.11),
      ),
      color: palette.coconut,
      flat: true,
    });
  }
  const turn = random() * Math.PI * 2;
  for (let index = 0; index < PALM_FRONDS; index += 1) {
    // Every third frond reaches up; the rest arch out and droop.
    const pitch = index % 3 === 0 ? 0.75 + random() * 0.25 : 0.1 + random() * 0.3;
    const length = 1.25 + random() * 0.45;
    parts.push({
      geometry: palmFrond,
      matrix: chain(
        crown,
        rotateY(turn + ((index + random() * 0.4) / PALM_FRONDS) * Math.PI * 2),
        rotateZ(pitch),
        rotateX((random() - 0.5) * 0.5),
        scale(length, length, length * 1.1),
      ),
      color: index % 2 === 0 ? palette.palmLeaf : palette.palmLeafDark,
      flat: true,
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
  const random = seededRandom(seed);
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
    // Close in around the big one, so the pile grows taller without crowding its miners.
    const distance = 0.5 + random() * 0.25;
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
