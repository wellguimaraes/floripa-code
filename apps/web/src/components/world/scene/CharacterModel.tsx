import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type AnimationAction,
  AnimationMixer,
  Box3,
  Color,
  type Group,
  type Material,
  MathUtils,
  Matrix4,
  type Mesh,
  MeshLambertMaterial,
  type Object3D,
  PropertyBinding,
  Quaternion,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { Pose } from "../definition/types";
import { keepColors } from "./contrast";
import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { LitMaterial } from "./lighting";
import { type FamilyShades, palette } from "./palette";

// KayKit "Rogue" (CC0), trimmed to these clips; see public/world/LICENSE.txt.
const MODEL_URL = `${import.meta.env.BASE_URL}world/character.glb`;
/** Characters stand this tall in world units, like the shape-built ones did. */
const HEIGHT = 1.45;
const FADE_SECONDS = 0.25;
const FADE_FPS = 30;
/** A quiet thread's character keeps swinging, at this fraction of the speed. */
const PONDER_SPEED = 0.35;

const CLIPS: Record<Pose | "walk", string> = {
  walk: "Walking_A",
  stand: "Idle",
  // Still at it, just slowly: see PONDER_SPEED.
  ponder: "1H_Melee_Attack_Chop",
  mine: "1H_Melee_Attack_Chop",
  wave: "Cheer",
  lie: "Lie_Idle",
  dead: "Lie_Idle",
  slump: "Sit_Floor_Idle",
  // Idle breathing, with both arms folded over it (see `foldArm`).
  crossArms: "Idle",
};

/** Which family shade each body part takes, by the model's node names. */
function shadeFor(name: string): keyof FamilyShades {
  if (name.includes("Head")) return "light";
  if (name.includes("Leg")) return "dark";
  return "base";
}

/**
 * The rigged, animated character in its family's colours. Animations only
 * advance on frames something else asked for (walking, the ambient ticker),
 * so a still character costs nothing; a pose change cross-fades briefly.
 */
export function CharacterModel(props: {
  readonly pose: Pose;
  readonly shades: FamilyShades;
  /** Read every frame: walking is decided by the route, not by React state. */
  readonly isWalking: () => boolean;
  /** Held in the right hand, e.g. a pickaxe. */
  readonly handItem?: React.ReactNode;
  /** Worn on top of the head, in head units: 1 wide, origin on the crown. */
  readonly headItem?: React.ReactNode;
  /** Holds the right arm straight up, whatever the clip does, e.g. to hold a balloon. */
  readonly raiseHand?: boolean;
  /** Holds both arms up, whatever the clip does, e.g. cheering from a seat. */
  readonly raiseHands?: boolean;
  /** Holds the right arm out ahead while standing still, e.g. to hold a fishing rod. */
  readonly reachHand?: boolean;
  /** Sitting, hangs the legs down over a drop ahead and swings them, e.g. off a pier's edge. */
  readonly dangleLegs?: boolean;
  /** Keeps the head turned toward this, glancing around now and then, e.g. a fishing bobber. */
  readonly watch?: React.RefObject<Object3D | null> | undefined;
  /** Receives the right hand, so the caller can tie things to it. */
  readonly handRef?: React.RefObject<Object3D | null>;
}) {
  const { pose, shades, isWalking, handItem, headItem, handRef, watch } = props;
  const { raiseHand = false, raiseHands = false, reachHand = false, dangleLegs = false } = props;
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const invalidate = useThree((state) => state.invalidate);

  const rig = useMemo(() => {
    const scene = cloneSkinned(gltf.scene);
    const height = new Box3().setFromObject(gltf.scene, true).getSize(new Vector3()).y;
    scene.scale.setScalar(HEIGHT / (height || 1));
    const materials = new Map<Mesh, MeshLambertMaterial>();
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as Material & { map?: MeshLambertMaterial["map"] };
      const material = new MeshLambertMaterial({ map: source.map ?? null });
      keepColors(material);
      mesh.material = material;
      mesh.frustumCulled = false;
      materials.set(mesh, material);
    });
    const head = scene.getObjectByName("head") ?? null;
    const mixer = new AnimationMixer(scene);
    const actions = new Map<string, AnimationAction>(
      gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]),
    );
    return {
      scene,
      mixer,
      actions,
      materials,
      // The loader strips dots from names: "handslot.r" becomes "handslotr".
      hand: scene.getObjectByName(PropertyBinding.sanitizeNodeName("handslot.r")) ?? null,
      head,
      crown: head === null ? null : crownSeat(scene, head),
      // The head's turn facing ahead, in the rest pose: the base for `watchTarget`.
      headRest: head?.getWorldQuaternion(new Quaternion()) ?? null,
      // Keeps characters out of step with each other.
      seed: scene.id * 3.7,
      arm: bones(scene, ["upperarm.r", "lowerarm.r", "wrist.r"]),
      armLeft: bones(scene, ["upperarm.l", "lowerarm.l", "wrist.l"]),
      legs: [
        bones(scene, ["upperleg.l", "lowerleg.l", "foot.l"]),
        bones(scene, ["upperleg.r", "lowerleg.r", "foot.r"]),
      ],
    };
  }, [gltf]);

  useEffect(() => {
    for (const [mesh, material] of rig.materials) {
      const color = shades[shadeFor(mesh.name)];
      material.color.set(color);
    }
    // Repainted outside React's props, so ask for the frame that shows it:
    // nothing else redraws a still portrait.
    invalidate();
  }, [rig, shades, invalidate]);

  // The hand item is rendered here, then moved onto its bone so it follows the
  // animation; sized in world units, so undo the model's own scale. The
  // reconciler still thinks the item belongs to the character's root, and puts
  // it back there whenever an ancestor moves (the character list reorders), so
  // every frame checks it is still on the bone, before anything is drawn.
  const handGroup = useRef<Group>(null);
  const headGroup = useRef<Group>(null);
  const deadEyes = useRef<Group>(null);
  useLayoutEffect(() => {
    const items = [handGroup.current, headGroup.current];
    seatOn(rig.hand, items[0]!);
    seatOn(rig.head, items[1]!);
    return () => {
      for (const item of items) item?.removeFromParent();
    };
  }, [rig]);

  const playing = useRef<AnimationAction | null>(null);
  const fadeUntil = useRef(0);
  // Effects can re-run while refs survive (hot reload, strict mode), so forget
  // the stopped clip too; the next frame starts it again instead of leaving the
  // rig in its bind pose.
  useEffect(
    () => () => {
      rig.mixer.stopAllAction();
      playing.current = null;
    },
    [rig],
  );
  useFrame((state, delta) => {
    seatOn(rig.hand, handGroup.current);
    seatOn(rig.head, headGroup.current);
    const next = rig.actions.get(CLIPS[isWalking() ? "walk" : pose]) ?? null;
    if (next !== playing.current) {
      const previous = playing.current;
      next
        ?.reset()
        .fadeIn(previous === null ? 0 : FADE_SECONDS)
        .play();
      previous?.fadeOut(FADE_SECONDS);
      playing.current = next;
      fadeUntil.current = performance.now() + FADE_SECONDS * 1000;
    }
    // Mining and pondering share a clip, so the speed is set every frame, not on a switch.
    if (playing.current !== null) {
      playing.current.timeScale = !isWalking() && pose === "ponder" ? PONDER_SPEED : 1;
    }
    // Draw the fade through, then let the scene go still again.
    if (performance.now() < fadeUntil.current) drawSoon(state.invalidate, FADE_FPS);
    rig.mixer.update(Math.min(delta, 0.1));
    const dead = pose === "dead" && !isWalking();
    if (deadEyes.current !== null) deadEyes.current.visible = dead;
    if (dead) {
      spreadArm(rig.arm, rig.head);
      spreadArm(rig.armLeft, rig.head);
    } else if (pose === "crossArms" && !isWalking()) {
      foldArm(rig.arm, true);
      foldArm(rig.armLeft, false);
    } else if (raiseHands) {
      raiseArm(rig.arm);
      raiseArm(rig.armLeft);
    } else if (raiseHand) raiseArm(rig.arm);
    else if (reachHand && !isWalking()) reachArm(rig.arm);
    const time = state.clock.elapsedTime + rig.seed;
    if (dangleLegs && pose === "slump" && !isWalking()) {
      rig.legs.forEach((leg, index) => {
        // The legs kick in turn.
        const kick = Math.sin((time / KICK_SECONDS) * Math.PI * 2 + index * Math.PI);
        dangleLeg(leg, rig.scene, kick);
      });
    }
    const target = watch?.current;
    if (target && rig.head !== null && rig.headRest !== null && !isWalking()) {
      watchTarget(rig.head, rig.headRest, target, time);
    }
  });

  useLayoutEffect(() => {
    if (handRef === undefined) return;
    handRef.current = rig.hand;
    return () => {
      handRef.current = null;
    };
  }, [rig, handRef]);

  return (
    <>
      <primitive object={rig.scene} />
      <group ref={handGroup} scale={1 / rig.scene.scale.x}>
        {handItem}
      </group>
      {rig.crown !== null ? (
        <group
          ref={headGroup}
          position={rig.crown.position}
          quaternion={rig.crown.quaternion}
          scale={rig.crown.scale}
        >
          {headItem}
          {pose === "dead" ? <DeadEyes ref={deadEyes} face={shades.light} /> : null}
        </group>
      ) : null}
    </>
  );
}

/**
 * Where head items sit, in the head bone's space: on top of the head mesh in
 * the bind pose, upright, scaled so one unit is the head's width. Measured
 * from the mesh, so it needs no knowledge of the rig's bone axes.
 */
function crownSeat(scene: Object3D, head: Object3D) {
  const mesh = scene.getObjectByName("Rogue_Head");
  if (mesh === undefined) return null;
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(mesh, true);
  const width = box.max.x - box.min.x;
  if (!(width > 0)) return null;
  const top = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
  // The scene has no parent yet, so world space is its scaled space: the box
  // is in world units. Express the seat in the bone's frame.
  const seat = new Matrix4()
    .copy(head.matrixWorld)
    .invert()
    .multiply(new Matrix4().compose(top, new Quaternion(), new Vector3(width, width, width)));
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  seat.decompose(position, quaternion, scale);
  return { position, quaternion, scale };
}

function bones(scene: Object3D, names: ReadonlyArray<string>): Array<Object3D | null> {
  // The loader strips dots from names: "upperarm.r" becomes "upperarmr".
  return names.map((name) => scene.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ?? null);
}

// The model's eyes, measured from its head mesh, in head units from the crown
// (see `crownSeat`): x right, y up, z toward the face.
const EYES = [-0.193, 0.179];
const EYE_Y = -0.526;
const EYE_FRONT = 0.4;
const EYE_SIZE = 0.115;
/** How much the head's texture darkens its colour around the eyes. */
const FACE_SHADE = 0.55;

/**
 * Crosses over the eyes of an agent out of quota: a patch of face hides each
 * eye and an × is drawn on it. Toggled per frame, so it only shows once the
 * agent lies down.
 */
function DeadEyes({ ref, face }: { readonly ref: React.Ref<Group>; readonly face: string }) {
  const skin = useMemo(
    () => `#${new Color(face).multiplyScalar(FACE_SHADE).getHexString()}`,
    [face],
  );
  return (
    <group ref={ref} visible={false}>
      {EYES.map((x) => (
        <group key={x} position={[x, EYE_Y, EYE_FRONT]}>
          <mesh geometry={geometry.box} scale={[EYE_SIZE * 1.4, EYE_SIZE * 1.4, 0.02]}>
            <LitMaterial color={skin} />
          </mesh>
          {[Math.PI / 4, -Math.PI / 4].map((angle) => (
            <mesh
              key={angle}
              geometry={geometry.box}
              position-z={0.015}
              rotation-z={angle}
              scale={[EYE_SIZE * 1.5, EYE_SIZE * 0.32, 0.02]}
            >
              <meshBasicMaterial color={palette.eye} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Moves `item` onto `bone`, unless it is already there. */
function seatOn(bone: Object3D | null, item: Object3D | null): void {
  if (bone !== null && item !== null && item.parent !== bone) bone.add(item);
}

const boneWorld = new Quaternion();
const parentWorld = new Quaternion();
const turn = new Quaternion();
const along = new Vector3();
const shoulder = new Vector3();
const torso = new Vector3();
const reach = new Vector3();
const forward = new Vector3();
const across = new Vector3();
const outward = new Vector3();

/** Points the arm up and a little outward, e.g. to hold a balloon. */
function raiseArm(arm: ReadonlyArray<Object3D | null>): void {
  const upper = arm[0];
  if (!upper?.parent) return;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder);
  upper.parent.getWorldPosition(torso);
  // Out to the side and a little forward: the head is big and the arms are
  // short, so straight up would bury the hand in the head.
  reach.set(shoulder.x - torso.x, 0, shoulder.z - torso.z).normalize();
  forward.set(0, 0, 1).applyQuaternion(upper.parent.getWorldQuaternion(parentWorld));
  reach.addScaledVector(forward, 0.35);
  reach.y = 1.5;
  pointLimb(arm, reach.normalize());
}

/** Points the arm ahead, a little outward and down, e.g. to hold a rod out. */
function reachArm(arm: ReadonlyArray<Object3D | null>): void {
  const upper = arm[0];
  if (!upper?.parent) return;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder);
  upper.parent.getWorldPosition(torso);
  reach
    .set(shoulder.x - torso.x, 0, shoulder.z - torso.z)
    .normalize()
    .multiplyScalar(0.25);
  forward.set(0, 0, 1).applyQuaternion(upper.parent.getWorldQuaternion(parentWorld));
  forward.y = 0;
  reach.add(forward.normalize());
  reach.y = -0.3;
  pointLimb(arm, reach.normalize());
}

/**
 * Folds the arm across the chest: elbow by the side, forearm over to the
 * other side. With both folded, the `front` one lies over the other.
 */
function foldArm(arm: ReadonlyArray<Object3D | null>, front: boolean): void {
  const upper = arm[0];
  if (!upper?.parent) return;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder);
  upper.parent.getWorldPosition(torso);
  outward.set(shoulder.x - torso.x, 0, shoulder.z - torso.z).normalize();
  forward.set(0, 0, 1).applyQuaternion(upper.parent.getWorldQuaternion(parentWorld));
  forward.y = 0;
  forward.normalize();
  reach.set(0, -1, 0).addScaledVector(forward, 0.45).addScaledVector(outward, 0.15).normalize();
  across
    .copy(outward)
    .negate()
    .addScaledVector(forward, front ? 0.45 : 0.25)
    .setY(front ? 0.3 : 0.15)
    .normalize();
  pointLimb(arm, reach, across);
}

/** Flings the arm out sideways along the ground, a little toward the head, for lying flat. */
function spreadArm(arm: ReadonlyArray<Object3D | null>, head: Object3D | null): void {
  const upper = arm[0];
  if (!upper?.parent || head === null) return;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder);
  upper.parent.getWorldPosition(torso);
  head.getWorldPosition(forward).sub(torso).normalize();
  reach.subVectors(shoulder, torso).normalize().addScaledVector(forward, 0.4);
  reach.y = 0;
  pointLimb(arm, reach.normalize());
}

/** Seconds for one swing of a dangling leg, out and back. */
const KICK_SECONDS = 1.8;

/**
 * Thigh out ahead, shin hanging down: sitting on an edge, from the
 * floor-sitting clip. `kick`, from -1 to 1, swings the shin back and out.
 */
function dangleLeg(leg: ReadonlyArray<Object3D | null>, body: Object3D, kick: number): void {
  forward.set(0, 0, 1).applyQuaternion(body.getWorldQuaternion(parentWorld));
  forward.y = 0;
  forward.normalize();
  reach.copy(forward).setY(-0.2).normalize();
  across
    .copy(forward)
    .multiplyScalar(0.25 + 0.3 * kick)
    .setY(-1)
    .normalize();
  pointLimb(leg, reach, across);
}

/** Seconds between chances to look away from what the head watches. */
const GLANCE_EVERY = 7;
/** How far a glance turns the head aside, in radians. */
const GLANCE_ANGLE = 0.9;
const UP = new Vector3(0, 1, 0);
const ORIGIN = new Vector3();
const gaze = new Vector3();
const headAt = new Vector3();
const look = new Matrix4();

/**
 * How far aside the head is turned at `time`, from -1 (left) to 1 (right):
 * now and then, for a couple of seconds, it looks off to one side and back.
 */
function glance(time: number): number {
  const round = Math.floor(time / GLANCE_EVERY);
  const into = time - round * GLANCE_EVERY;
  const roll = MathUtils.euclideanModulo(Math.sin(round * 12.9898) * 43758.5453, 1);
  if (roll > 0.6) return 0;
  const side = roll < 0.3 ? 1 : -1;
  return side * MathUtils.smoothstep(into, 4, 4.6) * (1 - MathUtils.smoothstep(into, 6.2, 6.9));
}

/**
 * Turns the head to face `target`, and away from it now and then (see
 * `glance`), looking up toward the horizon as it does. Built from the head's
 * rest turn each frame, so it holds whether or not the clip moves the head.
 */
function watchTarget(head: Object3D, rest: Quaternion, target: Object3D, time: number): void {
  target.getWorldPosition(gaze);
  head.getWorldPosition(headAt);
  gaze.sub(headAt).normalize();
  const aside = glance(time);
  gaze.y *= 1 - Math.abs(aside) * 0.8;
  gaze.applyAxisAngle(UP, aside * GLANCE_ANGLE).normalize();
  // The rest pose faces +z: turn +z onto the gaze, upright.
  turn.setFromRotationMatrix(look.lookAt(gaze, ORIGIN, UP)).multiply(rest);
  head.parent!.getWorldQuaternion(parentWorld);
  head.quaternion.copy(parentWorld.invert().multiply(turn));
  head.updateWorldMatrix(false, true);
}

/**
 * Turns each bone of an arm or leg, after the clip has posed it, so the next
 * joint sits straight along `direction` (in world space), or the forearm or
 * shin along `forearm` when given. Works from joint positions, so it needs no
 * knowledge of the rig's bone axes.
 */
function pointLimb(
  arm: ReadonlyArray<Object3D | null>,
  direction: Vector3,
  forearm: Vector3 = direction,
): void {
  const [upper, lower, wrist] = arm;
  if (!upper || !lower || !wrist) return;
  for (const [bone, child, toward] of [
    [upper, lower, direction],
    [lower, wrist, forearm],
  ] as const) {
    bone.updateWorldMatrix(true, false);
    along.copy(child.position).normalize().applyQuaternion(bone.getWorldQuaternion(boneWorld));
    turn.setFromUnitVectors(along, toward).multiply(boneWorld);
    bone.parent!.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(turn));
  }
  upper.updateWorldMatrix(false, true);
}

/** Starts loading the model before the first character needs it. */
export function preloadCharacterModel(): void {
  useLoader.preload(GLTFLoader, MODEL_URL);
}
