import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  type Group,
  Line,
  LineBasicMaterial,
  type Mesh,
  type Object3D,
  type Sprite,
  Vector3,
} from "three";

import type { Pose, TerrainKind, Vec3, WorldMovement } from "../definition/types";
import { type Obstacle, planRoute } from "../engine/route";
import type { Placement } from "../engine/slots";
import type { WorldCharacter } from "../engine/world";
import { balloonTexture } from "./balloons";
import { CharacterModel } from "./CharacterModel";
import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { Hat } from "./Hat";
import { KeepColorContext, keepColors } from "./contrast";
import { CharacterGlow, LitMaterial } from "./lighting";
import { palette } from "./palette";
import { SelectionRing } from "./SelectionRing";
import type { Ground } from "./shadows";

export type { FamilyShades } from "./palette";
import type { FamilyShades } from "./palette";

/** Long idle gaps arrive as one huge frame delta; never let a walker teleport. */
const MAX_FRAME_DELTA = 0.1;
const DRAG_CLICK_TOLERANCE_PX = 4;
/** On-screen balloon size, whatever the zoom. */
export const BALLOON_PX = 46;
/** The balloon sprite's name, so overlays can find it and sit above it. */
export const BALLOON_NAME = "balloon";
/** The hitbox's name, so the island under a character can tell the click was the character's. */
export const HITBOX_NAME = "character-hitbox";
/** On-screen length of the string between the raised hand and the balloon. */
const STRING_PX = 30;
/** Where the hand is before the model loads, in the character's own units. */
const FALLBACK_HAND: readonly [number, number, number] = [0.3, 1.5, 0];
/** Standing, the hitbox runs from the feet to just above the hat. */
const HITBOX_CENTER_Y = 0.79;
const handPoint = new Vector3();

interface Motion {
  readonly position: [number, number, number];
  heading: number;
  route: Vec3[];
}

export function Character(props: {
  readonly character: WorldCharacter;
  /** The family's colour; kids get their parent's. */
  readonly shades: FamilyShades;
  /** The worktree's hat; null in the project checkout. */
  readonly hat: number | null;
  /** What to walk around on the way to a new spot. */
  readonly obstacles: ReadonlyArray<Obstacle>;
  /** The island's ground height, so a character on the lawn stands on it. */
  readonly ground: Ground;
  /** Which ground shows at a spot on the island, so the selection ring can suit it. */
  readonly surface: (x: number, z: number) => TerrainKind | null;
  readonly movement: WorldMovement;
  readonly selected: boolean;
  readonly onSelect: (character: WorldCharacter) => void;
  /** An option- or alt-click: straight to the character's chat. */
  readonly onOpen: (character: WorldCharacter) => void;
  /** A cmd- or ctrl-click: adds the character to the selection, or takes it out. */
  readonly onPick: (character: WorldCharacter) => void;
  /** A right-click, at that screen point. */
  readonly onMenu: (character: WorldCharacter, point: { x: number; y: number }) => void;
  /** Hands out the character's root so overlays (the reply bubble) can follow it. */
  readonly onRoot: (key: string, root: Group | null) => void;
  /** Screen point to anchor a label at, or null when the pointer leaves. */
  readonly onHover: (character: WorldCharacter, point: { x: number; y: number } | null) => void;
}) {
  const {
    character,
    shades,
    hat,
    obstacles,
    ground,
    surface,
    movement,
    selected,
    onRoot,
    onHover,
  } = props;
  const { onSelect, onOpen, onPick, onMenu } = props;
  const { facts, placement, activity, intent } = character;
  // On a seat, beach poses become sitting back, and a wave becomes both arms raised.
  const seated = placement.seat !== undefined;
  const pose = seated ? "slump" : activity.pose;
  const invalidate = useThree((state) => state.invalidate);

  const root = useRef<Group>(null);
  const balloon = useRef<Sprite>(null);
  const hand = useRef<Object3D | null>(null);
  const string = useMemo(() => {
    const line = new Line(
      new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(6), 3)),
      new LineBasicMaterial({ color: palette.balloonString }),
    );
    line.frustumCulled = false;
    return line;
  }, []);
  useEffect(
    () => () => {
      string.geometry.dispose();
      string.material.dispose();
    },
    [string],
  );
  const hitbox = useRef<Mesh>(null);
  const rod = useRef<Group>(null);
  const bobber = useRef<Mesh>(null);
  const body = useRef<Group>(null);
  const head = useRef<Group>(null);
  const armLeft = useRef<Group>(null);
  const armRight = useRef<Group>(null);
  const legLeft = useRef<Group>(null);
  const legRight = useRef<Group>(null);
  // Starts at its spot: a character first appears in place, not walking in from nowhere.
  const motion = useRef<Motion>({
    position: [...placement.position],
    heading: placement.facing,
    route: [],
  });
  const lastPlacement = useRef<Placement | null>(null);
  useEffect(() => {
    onRoot(facts.key, root.current);
    return () => onRoot(facts.key, null);
  }, [facts.key, onRoot]);

  useEffect(() => {
    const previous = lastPlacement.current;
    lastPlacement.current = placement;
    if (previous === null || samePlacement(previous, placement)) return;
    const current = motion.current;
    // Off a pier through its foot, and onto one the same way; along the deck, straight.
    const alongDeck = previous.via !== undefined && sameVec(previous.via, placement.via);
    const stops = alongDeck
      ? []
      : [previous.via, placement.via].filter((stop): stop is Vec3 => stop !== undefined);
    let from: Vec3 = [...current.position];
    current.route = [];
    for (const to of [...stops, placement.position]) {
      current.route.push(...planRoute({ from, to, obstacles }));
      from = to;
    }
    invalidate();
  }, [placement, obstacles, invalidate]);

  const speed = movement.walkSpeed * (facts.kid ? movement.kidSpeedScale : 1);
  useFrame((state, frameDelta) => {
    const current = motion.current;
    const group = root.current;
    if (group === null) return;
    const walking = current.route.length > 0;
    if (walking) {
      let budget = speed * Math.min(frameDelta, MAX_FRAME_DELTA);
      while (budget > 0 && current.route.length > 0) {
        const target = current.route[0]!;
        const dx = target[0] - current.position[0];
        const dy = target[1] - current.position[1];
        const dz = target[2] - current.position[2];
        const distance = Math.hypot(dx, dz);
        if (distance > 1e-4) current.heading = Math.atan2(dx, dz);
        if (distance <= budget) {
          current.position[0] = target[0];
          current.position[1] = target[1];
          current.position[2] = target[2];
          current.route.shift();
          budget -= distance;
        } else {
          const step = budget / distance;
          current.position[0] += dx * step;
          current.position[1] += dy * step;
          current.position[2] += dz * step;
          budget = 0;
        }
      }
      // Keep frames coming until the walk ends, plus one to draw the arrival
      // pose, at a capped rate rather than the display's.
      drawSoon(state.invalidate, movement.walkFps);
    }
    if (balloon.current !== null) {
      // Balloons keep one size on screen, so they stay easy to spot zoomed out:
      // world size is pixels over zoom, less the character's own scale. The
      // balloon floats a string's length above the raised hand.
      const unit = 1 / state.camera.zoom / group.scale.y;
      if (hand.current === null) handPoint.set(...FALLBACK_HAND);
      else group.worldToLocal(hand.current.getWorldPosition(handPoint));
      const balloonY = handPoint.y + (STRING_PX + BALLOON_PX / 2) * unit;
      balloon.current.scale.setScalar(BALLOON_PX * unit);
      balloon.current.position.set(handPoint.x, balloonY, handPoint.z);
      const ends = string.geometry.getAttribute("position") as BufferAttribute;
      ends.setXYZ(0, handPoint.x, handPoint.y, handPoint.z);
      ends.setXYZ(1, handPoint.x, balloonY - (BALLOON_PX / 2) * unit, handPoint.z);
      ends.needsUpdate = true;
    }
    // Climbs onto a seat on arrival, and off it before walking away.
    const lift = walking ? 0 : (placement.seat ?? 0);
    const [x, y, z] = current.position;
    group.position.set(x, y + lift + ground(x, z), z);
    group.rotation.y = current.route.length > 0 ? current.heading : placement.facing;
    if (rod.current !== null) rod.current.visible = !walking;
    if (hitbox.current !== null) {
      // Lying down, the model stretches back along -z at about knee height.
      const lying = !walking && (pose === "lie" || pose === "dead");
      hitbox.current.rotation.x = lying ? Math.PI / 2 : 0;
      hitbox.current.position.set(0, lying ? 0.3 : HITBOX_CENTER_Y, lying ? -0.35 : 0);
    }
    applyPose(walking ? "walk" : pose, state.clock.elapsedTime, {
      body,
      head,
      armLeft,
      armRight,
      legLeft,
      legRight,
    });
  });

  const select = (event: ThreeEvent<MouseEvent>, open = event.nativeEvent.altKey) => {
    if (event.delta > DRAG_CLICK_TOLERANCE_PX) return;
    event.stopPropagation();
    if (open) onOpen(character);
    else if (event.nativeEvent.metaKey || event.nativeEvent.ctrlKey) onPick(character);
    else onSelect(character);
  };
  const openMenu = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    event.nativeEvent.preventDefault();
    onMenu(character, { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
  };
  // Only the hitbox and the balloon take the pointer. Handlers on the root
  // would raycast every limb, and the gaps between them flicker the hover.
  const pointer = {
    onClick: select,
    onContextMenu: openMenu,
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      onHover(character, { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      onHover(character, null);
      document.body.style.cursor = "";
    },
  };
  const scale = movement.characterScale * (facts.kid ? movement.kidScale : 1);

  return (
    // Position and heading are written by the frame loop, never by props, so a
    // re-render cannot snap a walking character to its destination.
    // Everything it wears and carries keeps its colours at any contrast, and
    // glows a little, so the colours read at night.
    <KeepColorContext value>
      <CharacterGlow>
        <group ref={root} scale={scale}>
          <mesh
            ref={hitbox}
            name={HITBOX_NAME}
            geometry={geometry.hitbox}
            position-y={HITBOX_CENTER_Y}
            visible={false}
            {...pointer}
          />
          <mesh geometry={geometry.shadow} rotation-x={-Math.PI / 2} position-y={0.012}>
            <meshBasicMaterial
              color={palette.shadow}
              transparent
              opacity={0.18}
              depthWrite={false}
            />
          </mesh>
          {selected ? (
            <SelectionRing
              fps={movement.walkFps}
              sandColor={shades.base}
              onSand={() => {
                const [x, , z] = motion.current.position;
                return surface(x, z) === "sand";
              }}
            />
          ) : null}
          <Suspense
            fallback={
              // The shape-built figure stands in while the model downloads.
              <ShapeBody
                rig={{ body, head, armLeft, armRight, legLeft, legRight }}
                shades={shades}
                pose={pose}
              />
            }
          >
            <CharacterModel
              pose={pose}
              shades={shades}
              isWalking={() => motion.current.route.length > 0}
              raiseHand={intent.balloon !== undefined}
              raiseHands={seated && activity.pose === "wave"}
              reachHand={placement.fishing === true}
              dangleLegs={placement.ledge === true}
              watch={placement.fishing === true ? bobber : undefined}
              handRef={hand}
              handItem={
                activity.pose === "mine" || activity.pose === "ponder" ? (
                  <ModelPickaxe />
                ) : undefined
              }
              headItem={hat === null ? undefined : <Hat style={hat} />}
            />
          </Suspense>
          {activity.pose === "mine" ||
          activity.pose === "ponder" ||
          activity.pose === "crossArms" ? (
            <NuggetPile count={facts.beat % (NUGGET_SPOTS.length + 1)} />
          ) : null}
          {placement.fishing === true ? (
            <FishingRod
              ref={rod}
              bobber={bobber}
              hand={hand}
              seat={placement.seat ?? 0}
              scale={scale}
            />
          ) : null}
          {intent.effect === "cloud" ? <Cloud /> : null}
          {intent.balloon !== undefined ? (
            <>
              <primitive object={string} />
              <sprite
                ref={balloon}
                name={BALLOON_NAME}
                renderOrder={10}
                {...pointer}
                // A question needs an answer, so its balloon goes straight to the chat.
                onClick={(event) =>
                  select(event, intent.balloon === "question" || event.nativeEvent.altKey)
                }
              >
                <spriteMaterial
                  map={balloonTexture(intent.balloon)}
                  depthTest={false}
                  onUpdate={keepColors}
                />
              </sprite>
            </>
          ) : null}
        </group>
      </CharacterGlow>
    </KeepColorContext>
  );
}

/** The shape-built figure: posed by `applyPose` in the frame loop. */
function ShapeBody(props: {
  readonly rig: PoseRig;
  readonly shades: FamilyShades;
  readonly pose: Pose;
}) {
  const { rig, shades, pose } = props;
  const { body, head, armLeft, armRight, legLeft, legRight } = rig;
  const activity = { pose };
  return (
    <>
      <group ref={body}>
        <Limb ref={legLeft} x={-0.1} y={0.32} color={shades.dark} kind="leg" />
        <Limb ref={legRight} x={0.1} y={0.32} color={shades.dark} kind="leg" />
        <mesh geometry={geometry.torso} position-y={0.6}>
          <LitMaterial color={shades.base} />
        </mesh>
        <Limb ref={armLeft} x={-0.27} y={0.82} color={shades.base} kind="arm" />
        <Limb ref={armRight} x={0.27} y={0.82} color={shades.base} kind="arm">
          {activity.pose === "mine" || activity.pose === "ponder" ? <Pickaxe /> : null}
        </Limb>
        <group ref={head} position-y={0.92}>
          <mesh geometry={geometry.head} position-y={0.2}>
            <LitMaterial color={shades.light} />
          </mesh>
          <mesh geometry={geometry.eye} position={[-0.075, 0.22, 0.2]}>
            <meshBasicMaterial color={palette.eye} />
          </mesh>
          <mesh geometry={geometry.eye} position={[0.075, 0.22, 0.2]}>
            <meshBasicMaterial color={palette.eye} />
          </mesh>
        </group>
      </group>
    </>
  );
}

// Hand items for the model, in its bone space: the hand slot's +y
// runs along a held tool's handle and +x along the swing, so a pickaxe's head
// lies along x to strike the pile.
function ModelPickaxe() {
  return (
    <group>
      <mesh geometry={geometry.cylinder} position-y={0.1} scale={[0.025, 0.6, 0.025]}>
        <LitMaterial color={palette.rod} />
      </mesh>
      <mesh geometry={geometry.box} position-y={0.38} scale={[0.42, 0.07, 0.06]}>
        <LitMaterial color={palette.metal} />
      </mesh>
    </group>
  );
}

/** The rod's length and its tilt forward from upright. */
const ROD_LENGTH = 1.5;
const ROD_TILT = 0.9;
const ROD_TIP_Y = Math.cos(ROD_TILT) * ROD_LENGTH;
const ROD_TIP_Z = Math.sin(ROD_TILT) * ROD_LENGTH;
/** How much farther out than the tip the line meets the water. */
const LINE_REACH = 1.8;
const WATER_Y = -0.25;
/** The foam arc round the line, just over the water (and the shore's ripples). */
const ARC_Y = WATER_Y + 0.01;
const ARC_RADIUS = 0.12;
/** Where the hand holds the rod before the model loads, in the character's own units. */
const FALLBACK_GRIP: readonly [number, number, number] = [0.27, 0.6, 0.35];
const gripPoint = new Vector3();
const viewPoint = new Vector3();

/**
 * Held in the right hand and leaning out over the water ahead, its line
 * running out to a bobber. Rides on the character, so it is only there while
 * someone sits fishing. `seat` and `scale` place the character above the
 * water, so the line ends at the surface, in a half ring of foam on the
 * camera's side.
 */
function FishingRod({
  ref,
  bobber,
  hand,
  seat,
  scale,
}: {
  readonly ref: React.Ref<Group>;
  readonly bobber: React.RefObject<Mesh | null>;
  readonly hand: React.RefObject<Object3D | null>;
  readonly seat: number;
  readonly scale: number;
}) {
  const rod = useRef<Group>(null);
  const arc = useRef<Group>(null);
  const line = useMemo(() => {
    const created = new Line(
      new BufferGeometry().setAttribute("position", new BufferAttribute(new Float32Array(6), 3)),
      new LineBasicMaterial({ color: palette.fishingLine }),
    );
    created.frustumCulled = false;
    return created;
  }, []);
  useEffect(
    () => () => {
      line.geometry.dispose();
      line.material.dispose();
    },
    [line],
  );
  // In the character's own units, which are scaled; the water's height is not.
  const waterY = (WATER_Y - seat) / scale;
  const arcY = (ARC_Y - seat) / scale;
  // The hand moves with the animation, so the rod follows it every frame.
  useFrame((state) => {
    const group = rod.current?.parent;
    if (rod.current === null || bobber.current === null || arc.current === null || !group) return;
    if (hand.current === null) gripPoint.set(...FALLBACK_GRIP);
    else group.worldToLocal(hand.current.getWorldPosition(gripPoint));
    rod.current.position.copy(gripPoint);
    const tipX = gripPoint.x;
    const tipY = gripPoint.y + ROD_TIP_Y;
    const tipZ = gripPoint.z + ROD_TIP_Z;
    bobber.current.position.set(tipX, waterY, tipZ + LINE_REACH);
    // The arc's open side faces away from the camera, wherever the character faces.
    group.worldToLocal(viewPoint.copy(state.camera.position));
    arc.current.position.set(tipX, arcY, tipZ + LINE_REACH);
    arc.current.rotation.y = Math.atan2(viewPoint.x - tipX, viewPoint.z - tipZ - LINE_REACH);
    const ends = line.geometry.getAttribute("position") as BufferAttribute;
    ends.setXYZ(0, tipX, tipY, tipZ);
    ends.setXYZ(1, tipX, waterY, tipZ + LINE_REACH);
    ends.needsUpdate = true;
  });
  return (
    <group ref={ref}>
      <group ref={rod}>
        <mesh
          geometry={geometry.cylinder}
          position={[0, ROD_TIP_Y / 2, ROD_TIP_Z / 2]}
          rotation-x={ROD_TILT}
          scale={[0.02, ROD_LENGTH, 0.02]}
        >
          <LitMaterial color={palette.rod} />
        </mesh>
      </group>
      <primitive object={line} />
      <mesh ref={bobber} geometry={geometry.puff} scale={0.35}>
        <LitMaterial color={palette.bobber} />
      </mesh>
      <group ref={arc}>
        <mesh geometry={geometry.halfRing} rotation-x={-Math.PI / 2} scale={ARC_RADIUS}>
          <meshBasicMaterial color={palette.foam} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

function sameVec(a: Vec3, b: Vec3 | undefined): boolean {
  return b !== undefined && a.every((value, index) => value === b[index]);
}

function samePlacement(a: Placement, b: Placement): boolean {
  return (
    a.area === b.area &&
    a.slotIndex === b.slotIndex &&
    a.entry === b.entry &&
    a.position.every((value, index) => value === b.position[index])
  );
}

function Limb({
  ref,
  x,
  y,
  color,
  kind,
  children,
}: {
  readonly ref: React.Ref<Group>;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly kind: "arm" | "leg";
  /** Held in the hand, e.g. a tool; swings with the limb. */
  readonly children?: React.ReactNode;
}) {
  // The group is the joint; the mesh hangs below it so rotations swing the limb.
  return (
    <group ref={ref} position={[x, y, 0]}>
      <mesh geometry={kind === "arm" ? geometry.limb : geometry.leg} position-y={-0.16}>
        <LitMaterial color={color} />
      </mesh>
      {children}
    </group>
  );
}

/** Gripped at the hand, pointing forward along the forearm's swing. */
function Pickaxe() {
  return (
    <group position={[-0.05, -0.32, 0]} rotation-x={Math.PI / 2}>
      <mesh geometry={geometry.cylinder} position-y={0.22} scale={[0.025, 0.6, 0.025]}>
        <LitMaterial color={palette.rod} />
      </mesh>
      <mesh geometry={geometry.box} position-y={0.5} scale={[0.05, 0.06, 0.42]}>
        <LitMaterial color={palette.metal} />
      </mesh>
    </group>
  );
}

// Where nuggets land beside a miner, filled in order; the pile empties when full.
const NUGGET_SPOTS = [
  [0.45, 0.05, -0.15],
  [0.58, 0.05, -0.02],
  [0.5, 0.05, -0.3],
  [0.64, 0.05, -0.2],
  [0.52, 0.13, -0.16],
  [0.6, 0.12, -0.06],
] as const;

/** One nugget per beat: a growing pile means the agent's work is advancing. */
function NuggetPile({ count }: { readonly count: number }) {
  return (
    <>
      {NUGGET_SPOTS.slice(0, count).map(([x, y, z]) => (
        <mesh key={`${x}:${z}`} geometry={geometry.foliage} position={[x, y, z]} scale={0.07}>
          <LitMaterial color={palette.gold} flatShading />
        </mesh>
      ))}
    </>
  );
}

function Cloud() {
  return (
    <group position-y={1.75}>
      {[-0.14, 0, 0.14].map((x, index) => (
        <mesh key={x} geometry={geometry.puff} position={[x, index === 1 ? 0.06 : 0, 0]}>
          <LitMaterial color={palette.cloud} />
        </mesh>
      ))}
    </group>
  );
}

interface PoseRig {
  readonly body: React.RefObject<Group | null>;
  readonly head: React.RefObject<Group | null>;
  readonly armLeft: React.RefObject<Group | null>;
  readonly armRight: React.RefObject<Group | null>;
  readonly legLeft: React.RefObject<Group | null>;
  readonly legRight: React.RefObject<Group | null>;
}

/** Poses are driven by the clock, so a pose looks the same however often frames arrive. */
function applyPose(pose: Pose | "walk", time: number, rig: PoseRig) {
  const body = rig.body.current;
  const head = rig.head.current;
  const armLeft = rig.armLeft.current;
  const armRight = rig.armRight.current;
  const legLeft = rig.legLeft.current;
  const legRight = rig.legRight.current;
  if (!body || !head || !armLeft || !armRight || !legLeft || !legRight) return;

  body.position.set(0, 0, 0);
  body.rotation.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  armLeft.rotation.set(0, 0, 0);
  armRight.rotation.set(0, 0, 0);
  legLeft.rotation.set(0, 0, 0);
  legRight.rotation.set(0, 0, 0);
  const seated = pose === "slump";
  if (seated) {
    legLeft.rotation.x = -Math.PI / 2;
    legRight.rotation.x = -Math.PI / 2;
  }

  switch (pose) {
    case "walk": {
      const swing = Math.sin(time * 10) * 0.6;
      body.position.y = Math.abs(Math.sin(time * 10)) * 0.04;
      armLeft.rotation.x = swing;
      armRight.rotation.x = -swing;
      legLeft.rotation.x = -swing;
      legRight.rotation.x = swing;
      break;
    }
    case "wave":
      armRight.rotation.z = 2.6 + Math.sin(time * 8) * 0.35;
      break;
    case "mine": {
      // Wind up over the head slowly, swing down fast into the rock.
      const cycle = (time * 1.3) % 1;
      const lift = cycle < 0.75 ? cycle / 0.75 : 1 - (cycle - 0.75) / 0.25;
      armRight.rotation.x = -0.5 - lift * 2.4;
      armLeft.rotation.x = -0.5 - lift * 2.4;
      armLeft.rotation.z = -0.35;
      body.rotation.x = 0.25 - lift * 0.3;
      head.rotation.x = 0.2;
      break;
    }
    case "ponder":
      // Leaning on the pickaxe, scratching the head: no new output for a while.
      armRight.rotation.x = -0.35;
      armLeft.rotation.x = -2.6;
      armLeft.rotation.z = -0.9;
      head.rotation.z = 0.2;
      head.rotation.x = -0.1;
      break;
    case "crossArms":
      // Arms folded over the chest, waiting on a long command.
      armRight.rotation.x = -1.2;
      armRight.rotation.z = -0.8;
      armLeft.rotation.x = -1.1;
      armLeft.rotation.z = 0.8;
      break;
    case "slump":
      head.rotation.x = 0.45;
      armLeft.rotation.z = -0.15;
      armRight.rotation.z = 0.15;
      break;
    case "lie":
      // Head toward the chair's back (-z), feet toward its foot.
      body.rotation.x = -Math.PI / 2 + 0.3;
      body.position.set(0, 0.32, 0.5);
      break;
    case "dead":
      // Flat on the sand, arms flung out.
      body.rotation.x = -Math.PI / 2;
      body.position.set(0, 0.15, 0.5);
      armLeft.rotation.z = -Math.PI / 2;
      armRight.rotation.z = Math.PI / 2;
      break;
    case "stand":
      break;
  }
}
