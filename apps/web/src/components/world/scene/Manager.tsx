import { type ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useContext, useEffect, useMemo, useRef } from "react";
import {
  type AnimationAction,
  AnimationMixer,
  Box3,
  Color,
  CylinderGeometry,
  TorusGeometry,
  type Group,
  type Material,
  type Mesh,
  MeshLambertMaterial,
  type Object3D,
  PropertyBinding,
  Quaternion,
  type Sprite,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { Vec3, WorldDefinition } from "../definition/types";
import { balloonTexture } from "./balloons";
import { BALLOON_NAME, BALLOON_PX, HITBOX_NAME } from "./Character";
import { KeepColorContext, keepColors } from "./contrast";
import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { pointLimb } from "./CharacterModel";
import { CharacterGlow, GlowContext, LitMaterial } from "./lighting";
import { palette } from "./palette";
import type { Ground } from "./shadows";

// KayKit "Ranger" (CC0), without his quiver; see public/world/LICENSE.txt.
const MODEL_URL = `${import.meta.env.BASE_URL}world/manager.glb`;
/** As tall as the agents, before `STATURE`. */
const HEIGHT = 1.45;
/** He stands a head over the agents, so he's easy to find on the island. */
const STATURE = 1.35;
/** The meshes his height is measured on: not the cape. */
const BODY_MESH = /_(Body|Head|Leg)/;
const FADE_SECONDS = 0.25;
/** Working it out while he thinks: a second or so, so a modest rate is plenty. */
const THINK_FPS = 24;
const HITBOX_CENTER_Y = 0.79;
/** Height of the question balloon's centre over his feet, before scaling. */
const BALLOON_Y = 2.3;
const DRAG_CLICK_TOLERANCE_PX = 4;
// The megaphone, a red-and-white loudhailer, built along +y (turned to +z when held).
const BELL = new CylinderGeometry(0.2, 0.075, 0.3, 16, 1, true);
const BODY = new CylinderGeometry(0.085, 0.085, 0.16, 14);
const CAP = new CylinderGeometry(0.07, 0.08, 0.03, 14);
const DRIVER = new CylinderGeometry(0.04, 0.04, 0.1, 10);
const RIM = new TorusGeometry(0.2, 0.016, 6, 20);
const MEGAPHONE_RED = "#d9332b";
const MEGAPHONE_WHITE = "#ecebe7";
const MEGAPHONE_GREY = "#6c707c";
/** Held hanging by the grip: the bell points down and ahead, and a little away from him. */
const MEGAPHONE_DROOP = 0.9;
const MEGAPHONE_SPLAY = 0.35;
/** Calling, the grip sits here (his own units: +x his left, +z ahead), the mouthpiece at his mouth. */
const CALL_GRIP = new Vector3(0.1, 0.8, 0.32);
/** How fast he turns toward whoever he calls, and back, per second. */
const TURN_RATE = 6;
/** The areas he keeps an eye on, in turn, and how long he watches each (seconds). */
const LOOKOUT_AREAS = ["mine", "beach"];
/** How far his head turns from his body at most, and how fast it gets there. */
const HEAD_TURN = 1.1;
const HEAD_RATE = 4;
const LOOK_SECONDS: readonly [number, number] = [6, 10];

/** The middle of each watched area's spots on the island. */
function lookouts(definition: WorldDefinition): ReadonlyArray<Vec3> {
  return LOOKOUT_AREAS.flatMap((name) => {
    const area = definition.areas[name];
    if (area?.kind !== "fixed" || area.slots.length === 0) return [];
    const sum = area.slots.reduce(
      (total, slot) => [total[0] + slot.position[0], 0, total[2] + slot.position[2]] as Vec3,
      [0, 0, 0] as Vec3,
    );
    return [[sum[0] / area.slots.length, 0, sum[2] / area.slots.length] as Vec3];
  });
}
const TURN_FPS = 30;
const targetPoint = new Vector3();
const ownPoint = new Vector3();
const shoulderPoint = new Vector3();
const reachDirection = new Vector3();
const lookPoint = new Vector3();
const UP = new Vector3(0, 1, 0);
const headTurn = new Quaternion();
const headWorld = new Quaternion();
const headParent = new Quaternion();
const gripPoint = new Vector3();
/** The hair's swatch in his texture: column 1 of 8, row 0 of 4 (only the head uses it). */
const HAIR_UV = { left: 0.125, right: 0.25, bottom: 0.25 };
/** The swatch's linear brightness where the hair sits, which takes the tint unchanged. */
const HAIR_SHADE = 0.19;
/** How much of the sign colour's saturation his hair keeps: a muted take on it. */
const HAIR_SATURATION = 0.55;
const hairHsl = { h: 0, s: 0, l: 0 };

/**
 * Paints the head's hair (and beard) in `tint`, keeping the swatch's light and
 * shade; the glow at night follows. Everything else on the texture is left alone.
 */
function tintHair(material: MeshLambertMaterial, tint: { value: Color }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.hairTint = tint;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 hairTint;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        bool hair = vMapUv.x >= ${HAIR_UV.left} && vMapUv.x < ${HAIR_UV.right} && vMapUv.y < ${HAIR_UV.bottom};
        if (hair) {
          float shade = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = hairTint * clamp(shade / ${HAIR_SHADE}, 0.35, 1.4);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        if (hair) totalEmissiveRadiance = emissive * diffuseColor.rgb;`,
      );
  };
}

/**
 * The island's manager, standing at his spot. He looks around the island in
 * turns (the miners, the beach, the pier), works it out while routing a
 * message, and holds up a question balloon while he waits on your answer.
 */
export function Manager(props: {
  /** His island: where he stands, and the areas he looks around at. */
  readonly definition: WorldDefinition;
  readonly ground: Ground;
  readonly scale: number;
  readonly thinking: boolean;
  readonly asking: boolean;
  /** His hair's colour: the island's sign's. */
  readonly hair: string;
  /**
   * Set while he calls a message over to an agent: who to face, null when
   * there's nobody to face yet (a new agent).
   */
  readonly callTarget: (() => Object3D | null) | null;
  readonly onSelect: () => void;
  /** Hands out his root, under `rootKey`, so the popover can follow him. */
  readonly rootKey: string;
  readonly onRoot: (key: string, root: Group | null) => void;
}) {
  const { definition, ground, thinking, asking, hair, callTarget, onSelect, rootKey, onRoot } =
    props;
  const slot = definition.archipelago.manager;
  const watched = useMemo(() => lookouts(definition), [definition]);
  // Which area he's watching; moved on by a timer, so a still scene draws only the turns.
  const look = useRef(0);
  const calling = callTarget !== null;
  // On the root, so his hitbox, shadow and the popover over his head grow with him.
  const scale = props.scale * STATURE;
  const root = useRef<Group>(null);
  const balloon = useRef<Sprite>(null);
  useEffect(() => {
    onRoot(rootKey, root.current);
    return () => onRoot(rootKey, null);
  }, [rootKey, onRoot]);
  const invalidate = useThree((state) => state.invalidate);
  // Starting or ending a call needs a frame for the frame loop to turn him and raise
  // or lower the megaphone; the model's own loop runs on the same frames.
  const wasCalling = useRef(calling);
  useEffect(() => {
    if (wasCalling.current === calling) return;
    wasCalling.current = calling;
    invalidate();
  }, [calling, invalidate]);
  useEffect(() => {
    if (watched.length < 2) return;
    let id: ReturnType<typeof setTimeout>;
    const watchNext = () => {
      const [least, most] = LOOK_SECONDS;
      id = setTimeout(
        () => {
          look.current = (look.current + 1) % watched.length;
          invalidate();
          watchNext();
        },
        (least + Math.random() * (most - least)) * 1000,
      );
    };
    watchNext();
    return () => clearTimeout(id);
  }, [watched, invalidate]);
  useFrame((state, delta) => {
    const group = root.current;
    if (group !== null) {
      // Turns to face whoever he calls, then back to his spot's facing.
      const target = callTarget?.() ?? null;
      let facing = slot.facing;
      if (target !== null) {
        target.getWorldPosition(targetPoint);
        group.getWorldPosition(ownPoint);
        facing = Math.atan2(targetPoint.x - ownPoint.x, targetPoint.z - ownPoint.z);
      }
      const turn = Math.atan2(
        Math.sin(facing - group.rotation.y),
        Math.cos(facing - group.rotation.y),
      );
      const step = Math.min(1, TURN_RATE * Math.min(delta, 0.1));
      group.rotation.y = Math.abs(turn) < 0.01 ? facing : group.rotation.y + turn * step;
      if (Math.abs(turn) >= 0.01) drawSoon(state.invalidate, TURN_FPS);
    }
    if (balloon.current === null) return;
    // One size on screen at any zoom, like the agents' balloons.
    balloon.current.scale.setScalar(BALLOON_PX / state.camera.zoom / scale);
  });

  const [x, , z] = slot.position;
  const select = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > DRAG_CLICK_TOLERANCE_PX) return;
    event.stopPropagation();
    onSelect();
  };
  const pointer = {
    onClick: select,
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      document.body.style.cursor = "pointer";
    },
    onPointerOut: () => {
      document.body.style.cursor = "";
    },
  };

  return (
    <KeepColorContext value>
      <CharacterGlow>
        {/* Turned by the frame loop, so a re-render can't snap him back mid-turn. */}
        <group ref={root} position={[x, ground(x, z), z]} scale={scale}>
          <mesh
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
          <Suspense fallback={null}>
            <ManagerModel
              thinking={thinking}
              hair={hair}
              calling={calling}
              // Calling, he looks where his body faces: at the agent.
              watching={() =>
                calling ? null : (watched[look.current % Math.max(1, watched.length)] ?? null)
              }
            />
          </Suspense>
          {asking ? (
            <sprite
              ref={balloon}
              name={BALLOON_NAME}
              position-y={BALLOON_Y}
              renderOrder={10}
              {...pointer}
            >
              <spriteMaterial
                map={balloonTexture("question")}
                depthTest={false}
                onUpdate={keepColors}
              />
            </sprite>
          ) : null}
        </group>
      </CharacterGlow>
    </KeepColorContext>
  );
}

/** The rigged Ranger in his own colours. Idle advances only on frames others ask for. */
function ManagerModel(props: {
  readonly thinking: boolean;
  readonly hair: string;
  /** Holds the megaphone up at his mouth, his left arm reaching for it. */
  readonly calling: boolean;
  /** Where his head turns to, on his island; null looks straight ahead. Read every frame. */
  readonly watching: () => Vec3 | null;
}) {
  const { thinking, hair, calling, watching } = props;
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const invalidate = useThree((state) => state.invalidate);
  const glow = useContext(GlowContext);

  const rig = useMemo(() => {
    const scene = cloneSkinned(gltf.scene);
    const body = new Box3();
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if ((object as Mesh).isMesh && BODY_MESH.test(object.name)) body.expandByObject(object, true);
    });
    scene.scale.setScalar(HEIGHT / (body.getSize(new Vector3()).y || 1));
    const materials: MeshLambertMaterial[] = [];
    const hairTint = { value: new Color() };
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const source = mesh.material as Material & { map?: MeshLambertMaterial["map"] };
      const material = new MeshLambertMaterial({
        map: source.map ?? null,
        emissiveMap: source.map ?? null,
      });
      keepColors(material);
      if (mesh.name.endsWith("_Head")) tintHair(material, hairTint);
      mesh.material = material;
      mesh.frustumCulled = false;
      materials.push(material);
    });
    const mixer = new AnimationMixer(scene);
    const actions = new Map<string, AnimationAction>(
      gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]),
    );
    // The megaphone's hand. The loader strips dots from names: "handslot.l" becomes "handslotl".
    const hand = scene.getObjectByName(PropertyBinding.sanitizeNodeName("handslot.l")) ?? null;
    // The loader strips dots from names: "upperarm.l" becomes "upperarml".
    const arm = ["upperarm.l", "lowerarm.l", "wrist.l"].map(
      (name) => scene.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ?? null,
    );
    const head = scene.getObjectByName("head") ?? null;
    // A clip that never moves the head would leave each frame's turn on it to pile up.
    const headAnimated = gltf.animations.some((clip) =>
      clip.tracks.some((track) => track.name.startsWith("head.")),
    );
    return {
      scene,
      mixer,
      actions,
      materials,
      hand,
      hairTint,
      arm,
      head,
      headRest: head?.quaternion.clone() ?? null,
      headAnimated,
    };
  }, [gltf]);
  useEffect(() => {
    rig.hairTint.value.set(hair).getHSL(hairHsl);
    rig.hairTint.value.setHSL(hairHsl.h, hairHsl.s * HAIR_SATURATION, hairHsl.l);
    invalidate();
  }, [rig, hair, invalidate]);

  useEffect(() => {
    for (const material of rig.materials) {
      material.emissive.set(glow > 0 ? "#ffffff" : "#000000");
      material.setValues({ emissiveIntensity: glow });
    }
    invalidate();
  }, [rig, glow, invalidate]);

  const playing = useRef<AnimationAction | null>(null);
  const fadeUntil = useRef(0);
  useEffect(
    () => () => {
      rig.mixer.stopAllAction();
      playing.current = null;
    },
    [rig],
  );
  // Cross-fades between standing and thinking, then draws until the fade is through.
  useEffect(() => {
    const next = rig.actions.get(thinking ? "Interact" : "Idle_A") ?? null;
    if (next === playing.current) return;
    const previous = playing.current;
    next
      ?.reset()
      .fadeIn(previous === null ? 0 : FADE_SECONDS)
      .play();
    previous?.fadeOut(FADE_SECONDS);
    playing.current = next;
    fadeUntil.current = performance.now() + FADE_SECONDS * 1000;
    invalidate();
  }, [rig, thinking, invalidate]);
  // Turns his head, after the clip has posed it, toward what he's watching, within his neck's reach.
  const headYaw = useRef(0);
  const turnHead = (invalidate: () => void, delta: number) => {
    const body = rig.scene.parent;
    const point = watching();
    let want = 0;
    if (point !== null && body?.parent != null) {
      body.parent.localToWorld(lookPoint.set(...point));
      body.getWorldPosition(ownPoint);
      const toward = Math.atan2(lookPoint.x - ownPoint.x, lookPoint.z - ownPoint.z);
      const turn = Math.atan2(
        Math.sin(toward - body.rotation.y),
        Math.cos(toward - body.rotation.y),
      );
      want = Math.max(-HEAD_TURN, Math.min(HEAD_TURN, turn));
    }
    const left = want - headYaw.current;
    headYaw.current =
      Math.abs(left) < 0.01
        ? want
        : headYaw.current + left * Math.min(1, HEAD_RATE * Math.min(delta, 0.1));
    if (Math.abs(left) >= 0.01) drawSoon(invalidate, TURN_FPS);
    const head = rig.head;
    if (head?.parent == null || headYaw.current === 0) return;
    head.updateWorldMatrix(true, false);
    head.getWorldQuaternion(headWorld);
    headTurn.setFromAxisAngle(UP, headYaw.current).multiply(headWorld);
    head.parent.getWorldQuaternion(headParent);
    head.quaternion.copy(headParent.invert().multiply(headTurn));
    head.updateWorldMatrix(false, true);
  };

  useFrame((state, delta) => {
    if (thinking || performance.now() < fadeUntil.current) drawSoon(state.invalidate, THINK_FPS);
    if (!rig.headAnimated && rig.head !== null && rig.headRest !== null) {
      rig.head.quaternion.copy(rig.headRest);
    }
    rig.mixer.update(Math.min(delta, 0.1));
    turnHead(state.invalidate, delta);
    const held = megaphone.current;
    const holder = held?.parent;
    if (held == null || holder == null) return;
    rig.scene.updateMatrixWorld(true);
    if (calling) {
      // Up at his mouth, bell straight ahead, and the arm reaching for the grip.
      held.position.copy(CALL_GRIP);
      held.rotation.y = 0;
      const tilt = held.children[0];
      if (tilt !== undefined) tilt.rotation.x = 0;
      const shoulder = rig.arm[0];
      if (shoulder != null) {
        holder.localToWorld(gripPoint.copy(CALL_GRIP));
        shoulder.getWorldPosition(shoulderPoint);
        pointLimb(rig.arm, reachDirection.subVectors(gripPoint, shoulderPoint).normalize());
      }
      return;
    }
    // Otherwise it hangs in his hand, pointing ahead whatever the hand bone's axes.
    held.rotation.y = MEGAPHONE_SPLAY;
    const tilt = held.children[0];
    if (tilt !== undefined) tilt.rotation.x = MEGAPHONE_DROOP;
    if (rig.hand !== null) {
      held.position.copy(holder.worldToLocal(rig.hand.getWorldPosition(gripPoint)));
    }
  });

  const megaphone = useRef<Object3D>(null);
  return (
    <>
      <primitive object={rig.scene} />
      <Megaphone ref={megaphone} />
    </>
  );
}

/** Held by the grip at its origin; unturned, the bell points ahead (+z). */
function Megaphone({ ref }: { readonly ref: React.Ref<Object3D> }) {
  const along = Math.PI / 2;
  return (
    <group ref={ref} rotation-y={MEGAPHONE_SPLAY}>
      <group rotation-x={MEGAPHONE_DROOP}>
        {/* The pistol grip, slanting back under the body. */}
        <mesh geometry={geometry.box} rotation-x={-0.35} scale={[0.05, 0.16, 0.065]}>
          <LitMaterial color={MEGAPHONE_WHITE} />
        </mesh>
        <mesh geometry={BODY} position={[0, 0.1, -0.02]} rotation-x={along}>
          <LitMaterial color={MEGAPHONE_RED} />
        </mesh>
        <mesh geometry={CAP} position={[0, 0.1, -0.115]} rotation-x={along}>
          <LitMaterial color={MEGAPHONE_RED} />
        </mesh>
        <mesh geometry={BELL} position={[0, 0.1, 0.21]} rotation-x={along}>
          <LitMaterial color={MEGAPHONE_WHITE} side={2} />
        </mesh>
        <mesh geometry={DRIVER} position={[0, 0.1, 0.2]} rotation-x={along}>
          <LitMaterial color={MEGAPHONE_GREY} />
        </mesh>
        <mesh geometry={RIM} position={[0, 0.1, 0.36]}>
          <LitMaterial color={MEGAPHONE_GREY} />
        </mesh>
      </group>
    </group>
  );
}
