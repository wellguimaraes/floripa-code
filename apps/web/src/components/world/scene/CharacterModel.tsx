import { useFrame, useLoader } from "@react-three/fiber";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  type AnimationAction,
  AnimationMixer,
  Box3,
  type Group,
  type Material,
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
import { drawSoon } from "./frames";
import { NightContext, toNight } from "./lighting";
import type { FamilyShades } from "./palette";

// KayKit "Rogue" (CC0), trimmed to these clips; see public/world/LICENSE.txt.
const MODEL_URL = `${import.meta.env.BASE_URL}world/character.glb`;
/** Characters stand this tall in world units, like the shape-built ones did. */
const HEIGHT = 1.45;
const FADE_SECONDS = 0.25;
const FADE_FPS = 30;

const CLIPS: Record<Pose | "walk", string> = {
  walk: "Walking_A",
  stand: "Idle",
  ponder: "Idle",
  mine: "1H_Melee_Attack_Chop",
  wave: "Cheer",
  lie: "Lie_Idle",
  sleep: "Lie_Idle",
  slump: "Sit_Floor_Idle",
  fish: "Sit_Floor_Idle",
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
  /** Held in the right hand, e.g. a pickaxe or a rod. */
  readonly handItem?: React.ReactNode;
  /** Laid over the chest, e.g. a blanket. */
  readonly chestItem?: React.ReactNode;
  /** Holds the right arm straight up, whatever the clip does, e.g. to hold a balloon. */
  readonly raiseHand?: boolean;
  /** Receives the right hand, so the caller can tie things to it. */
  readonly handRef?: React.RefObject<Object3D | null>;
}) {
  const { pose, shades, isWalking, handItem, chestItem, raiseHand = false, handRef } = props;
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const night = useContext(NightContext);

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
      mesh.material = material;
      mesh.frustumCulled = false;
      materials.set(mesh, material);
    });
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
      arm: ["upperarm.r", "lowerarm.r", "wrist.r"].map(
        (name) => scene.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ?? null,
      ),
      chest: scene.getObjectByName("chest") ?? null,
    };
  }, [gltf]);

  useEffect(() => {
    for (const [mesh, material] of rig.materials) {
      const color = shades[shadeFor(mesh.name)];
      material.color.set(night ? toNight(color) : color);
    }
  }, [rig, shades, night]);

  useEffect(
    () => () => {
      rig.mixer.stopAllAction();
    },
    [rig],
  );

  const playing = useRef<AnimationAction | null>(null);
  const fadeUntil = useRef(0);
  useFrame((state, delta) => {
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
    // Draw the fade through, then let the scene go still again.
    if (performance.now() < fadeUntil.current) drawSoon(state.invalidate, FADE_FPS);
    rig.mixer.update(Math.min(delta, 0.1));
    if (raiseHand) raiseArm(rig.arm);
  });

  useLayoutEffect(() => {
    if (handRef === undefined) return;
    handRef.current = rig.hand;
    return () => {
      handRef.current = null;
    };
  }, [rig, handRef]);

  // Items are rendered here, then moved onto their bones so they follow the
  // animation; sized in world units, so undo the model's own scale.
  const handGroup = useRef<Group>(null);
  const chestGroup = useRef<Group>(null);
  useLayoutEffect(() => {
    const pairs = [
      [handGroup.current, rig.hand],
      [chestGroup.current, rig.chest],
    ] as const;
    for (const [item, bone] of pairs) {
      if (item !== null && bone !== null) bone.add(item);
    }
    return () => {
      for (const [item] of pairs) item?.removeFromParent();
    };
  }, [rig]);

  return (
    <>
      <primitive object={rig.scene} />
      <group ref={handGroup} scale={1 / rig.scene.scale.x}>
        {handItem}
      </group>
      <group ref={chestGroup} scale={1 / rig.scene.scale.x}>
        {chestItem}
      </group>
    </>
  );
}

const boneWorld = new Quaternion();
const parentWorld = new Quaternion();
const turn = new Quaternion();
const along = new Vector3();
const shoulder = new Vector3();
const torso = new Vector3();
const reach = new Vector3();
const forward = new Vector3();

/**
 * Points the arm up and a little outward, after the clip has posed it: each
 * bone turns so the next joint sits straight along `reach`. Works from joint
 * positions, so it needs no knowledge of the rig's bone axes.
 */
function raiseArm(arm: ReadonlyArray<Object3D | null>): void {
  const [upper, lower, wrist] = arm;
  if (!upper || !lower || !wrist || !upper.parent) return;
  upper.updateWorldMatrix(true, true);
  upper.getWorldPosition(shoulder);
  upper.parent.getWorldPosition(torso);
  // Out to the side and a little forward: the head is big and the arms are
  // short, so straight up would bury the hand in the head.
  reach.set(shoulder.x - torso.x, 0, shoulder.z - torso.z).normalize();
  forward.set(0, 0, 1).applyQuaternion(upper.parent.getWorldQuaternion(parentWorld));
  reach.addScaledVector(forward, 0.35);
  reach.y = 1.5;
  reach.normalize();
  for (const [bone, child] of [
    [upper, lower],
    [lower, wrist],
  ] as const) {
    bone.updateWorldMatrix(true, false);
    along.copy(child.position).normalize().applyQuaternion(bone.getWorldQuaternion(boneWorld));
    turn.setFromUnitVectors(along, reach).multiply(boneWorld);
    bone.parent!.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(turn));
  }
  upper.updateWorldMatrix(false, true);
}

/** Starts loading the model before the first character needs it. */
export function preloadCharacterModel(): void {
  useLoader.preload(GLTFLoader, MODEL_URL);
}
