import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  type Group,
  Line,
  LineBasicMaterial,
  type Object3D,
  type Sprite,
  Vector3,
} from "three";

import type { Pose, Vec3, WorldMovement, WorldRoads } from "../definition/types";
import { planRoute } from "../engine/roads";
import type { Placement } from "../engine/slots";
import type { WorldCharacter } from "../engine/world";
import { balloonTexture } from "./balloons";
import { CharacterModel } from "./CharacterModel";
import { geometry } from "./geometries";
import { LitMaterial } from "./lighting";
import { palette } from "./palette";

export type { FamilyShades } from "./palette";
import type { FamilyShades } from "./palette";

/** Long idle gaps arrive as one huge frame delta; never let a walker teleport. */
const MAX_FRAME_DELTA = 0.1;
const DRAG_CLICK_TOLERANCE_PX = 4;
/** On-screen balloon size, whatever the zoom. */
const BALLOON_PX = 46;
/** On-screen length of the string between the raised hand and the balloon. */
const STRING_PX = 30;
/** Where the hand is before the model loads, in the character's own units. */
const FALLBACK_HAND: readonly [number, number, number] = [0.3, 1.5, 0];
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
  readonly roads: WorldRoads;
  readonly movement: WorldMovement;
  readonly selected: boolean;
  readonly onSelect: (character: WorldCharacter) => void;
  /** Hands out the character's root so overlays (the reply bubble) can follow it. */
  readonly onRoot: (key: string, root: Group | null) => void;
  /** Screen point to anchor a label at, or null when the pointer leaves. */
  readonly onHover: (character: WorldCharacter, point: { x: number; y: number } | null) => void;
}) {
  const { character, shades, roads, movement, selected, onSelect, onRoot, onHover } = props;
  const { facts, placement, activity, intent } = character;
  // On a seat, beach poses become sitting back, and a wave becomes a raised arm.
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
    current.route = planRoute({
      roads,
      from: current.position,
      fromPlacement: previous,
      to: placement,
    }).slice(1);
    invalidate();
  }, [placement, roads, invalidate]);

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
      window.setTimeout(() => state.invalidate(), 1000 / movement.walkFps);
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
    group.position.set(current.position[0], current.position[1] + lift, current.position[2]);
    group.rotation.y = current.route.length > 0 ? current.heading : placement.facing;
    applyPose(walking ? "walk" : pose, state.clock.elapsedTime, {
      body,
      head,
      armLeft,
      armRight,
      legLeft,
      legRight,
    });
  });

  const select = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > DRAG_CLICK_TOLERANCE_PX) return;
    event.stopPropagation();
    onSelect(character);
  };
  const scale = movement.characterScale * (facts.kid ? movement.kidScale : 1);

  return (
    // Position and heading are written by the frame loop, never by props, so a
    // re-render cannot snap a walking character to its destination.
    <group
      ref={root}
      scale={scale}
      onClick={select}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(character, { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        onHover(character, null);
        document.body.style.cursor = "";
      }}
    >
      <mesh geometry={geometry.shadow} rotation-x={-Math.PI / 2} position-y={0.012}>
        <meshBasicMaterial color={palette.shadow} transparent opacity={0.18} depthWrite={false} />
      </mesh>
      {selected ? (
        <mesh geometry={geometry.ring} rotation-x={-Math.PI / 2} position-y={0.02}>
          <meshBasicMaterial color={palette.selection} />
        </mesh>
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
          raiseHand={intent.balloon !== undefined || (seated && activity.pose === "wave")}
          handRef={hand}
          handItem={
            activity.pose === "mine" || activity.pose === "ponder" ? (
              <ModelPickaxe />
            ) : activity.pose === "fish" ? (
              <ModelRod />
            ) : undefined
          }
          chestItem={pose === "sleep" ? <ModelBlanket color={shades.dark} /> : undefined}
        />
      </Suspense>
      {activity.pose === "mine" || activity.pose === "ponder" ? (
        <NuggetPile count={facts.beat % (NUGGET_SPOTS.length + 1)} />
      ) : null}
      {intent.effect === "cloud" ? <Cloud /> : null}
      {intent.balloon !== undefined ? (
        <>
          <primitive object={string} />
          <sprite ref={balloon} renderOrder={10}>
            <spriteMaterial map={balloonTexture(intent.balloon)} depthTest={false} />
          </sprite>
        </>
      ) : null}
    </group>
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
        {activity.pose === "sleep" ? (
          // Over the legs and chest; the body lies on its back, so local +z is up.
          <mesh geometry={geometry.box} position={[0, 0.4, 0.14]} scale={[0.58, 0.82, 0.05]}>
            <LitMaterial color={shades.dark} />
          </mesh>
        ) : null}
      </group>
      {activity.pose === "fish" ? <FishingRod /> : null}
    </>
  );
}

// Hand and chest items for the model, in its bone space: the hand slot's +y
// runs along a held tool's handle.
function ModelPickaxe() {
  return (
    <group>
      <mesh geometry={geometry.cylinder} position-y={0.1} scale={[0.025, 0.6, 0.025]}>
        <LitMaterial color={palette.rod} />
      </mesh>
      <mesh geometry={geometry.box} position-y={0.38} scale={[0.05, 0.06, 0.42]}>
        <LitMaterial color={palette.metal} />
      </mesh>
    </group>
  );
}

function ModelRod() {
  return (
    <mesh geometry={geometry.cylinder} position-y={0.6} scale={[0.02, 1.4, 0.02]}>
      <LitMaterial color={palette.rod} />
    </mesh>
  );
}

function ModelBlanket({ color }: { readonly color: string }) {
  return (
    <mesh geometry={geometry.box} position={[0, -0.25, 0.12]} scale={[0.7, 0.9, 0.06]}>
      <LitMaterial color={color} />
    </mesh>
  );
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

/** Held out over the water from the right hand, line hanging to the surface. */
function FishingRod() {
  return (
    <group position={[0.27, 0.55, 0.3]} rotation-x={0.9}>
      <mesh geometry={geometry.cylinder} position-y={0.8} scale={[0.02, 1.6, 0.02]}>
        <LitMaterial color={palette.rod} />
      </mesh>
      <mesh
        geometry={geometry.cylinder}
        position={[0, 1.6, -0.4]}
        rotation-x={-0.9}
        scale={[0.006, 1, 0.006]}
      >
        <meshBasicMaterial color={palette.foam} />
      </mesh>
    </group>
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
  const seated = pose === "slump" || pose === "fish";
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
    case "fish":
      // Sitting on the pier's edge, legs over the water.
      body.position.set(0, -0.3, 0);
      armRight.rotation.x = -1.2;
      armLeft.rotation.x = -1;
      break;
    case "slump":
      head.rotation.x = 0.45;
      armLeft.rotation.z = -0.15;
      armRight.rotation.z = 0.15;
      break;
    case "sleep":
      // Flat on the ground, feet toward where the slot faces (the fire).
      body.rotation.x = -Math.PI / 2;
      body.position.set(0, 0.2, 0);
      break;
    case "lie":
      // Head toward the chair's back (-z), feet toward its foot.
      body.rotation.x = -Math.PI / 2 + 0.3;
      body.position.set(0, 0.32, 0.5);
      break;
    case "stand":
      break;
  }
}
