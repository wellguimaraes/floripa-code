import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimationMixer,
  Box3,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  MeshLambertMaterial,
  Vector3,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

import type { WorldArchipelago } from "../definition/types";
import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { palette } from "./palette";

// Quaternius "Whale" (CC0); see public/world/LICENSE.txt.
const MODEL_URL = `${import.meta.env.BASE_URL}world/whale.glb`;
const WATER_Y = -0.25;
/** Nose to tail, in world units. */
const LENGTH = 4;
// The leap, in lengths: its middle starts and ends this deep, peaks this high
// over the water, and moves this far along its heading.
const DEPTH = 1;
const PEAK = 0.45;
const SPAN = 1.2;
/** How far it twists onto its side on the way down, as humpbacks do. */
const ROLL = 1.7;
const SPLASH_SECONDS = 1.2;
/** Where on the leap (0 to 1) its middle breaks the surface, going up and coming down. */
const CROSSINGS = (() => {
  const half = Math.sqrt(1 - DEPTH / (DEPTH + PEAK)) / 2;
  return [0.5 - half, 0.5 + half] as const;
})();

interface Sighting {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Yaw: facing f leaps toward (sin f, cos f). */
  readonly heading: number;
  /** Which way it rolls, 1 or -1. */
  readonly twist: number;
}

/** Height of the whale's middle and how far it has moved along its heading, at `u` of the leap. */
function leap(u: number) {
  return {
    y: WATER_Y + LENGTH * (-DEPTH + (DEPTH + PEAK) * 4 * u * (1 - u)),
    travel: LENGTH * SPAN * (u - 0.5),
  };
}

/**
 * Now and then a whale leaps out of the water near a random island and
 * splashes back in. Only one is up at a time, frames are drawn only while it
 * is, and no new leap starts while the tab is hidden. The model loads on the
 * first leap.
 */
export function WhaleSightings(props: {
  /** Island centres in world space and how far their shore reaches. */
  readonly islands: ReadonlyArray<{
    readonly x: number;
    readonly z: number;
    readonly shoreRadius: number;
  }>;
  readonly config: WorldArchipelago["whales"];
}) {
  const { islands, config } = props;
  const [sighting, setSighting] = useState<Sighting | null>(null);
  const islandsRef = useRef(islands);
  useEffect(() => {
    islandsRef.current = islands;
  }, [islands]);

  useEffect(() => {
    if (sighting !== null) return;
    const [min, max] = config.intervalSeconds;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(surface, (min + Math.random() * (max - min)) * 1000);
    };
    const surface = () => {
      const candidates = islandsRef.current;
      // Nobody is looking: wait for the next turn instead of leaping.
      if (document.visibilityState !== "visible" || candidates.length === 0) {
        schedule();
        return;
      }
      const island = candidates[Math.floor(Math.random() * candidates.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const [near, far] = config.offshore;
      const distance = island.shoreRadius + near + Math.random() * (far - near);
      // Leap along the shore, one way or the other.
      const along = angle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      setSighting({
        id: Date.now(),
        x: island.x + Math.cos(angle) * distance,
        z: island.z + Math.sin(angle) * distance,
        heading: Math.atan2(Math.cos(along), Math.sin(along)),
        twist: Math.random() < 0.5 ? 1 : -1,
      });
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [sighting, config]);

  return sighting === null ? null : (
    <Suspense fallback={null}>
      <Whale
        key={sighting.id}
        sighting={sighting}
        seconds={config.leapSeconds}
        fps={config.fps}
        onDone={() => setSighting(null)}
      />
    </Suspense>
  );
}

function Whale(props: {
  readonly sighting: Sighting;
  readonly seconds: number;
  readonly fps: number;
  readonly onDone: () => void;
}) {
  const { sighting, seconds, fps, onDone } = props;
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const body = useRef<Group>(null);
  const splashes = useRef<Array<Mesh | null>>([]);
  const startedAt = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);

  // Centred on its middle, nose toward +z, `LENGTH` long, swimming.
  const rig = useMemo(() => {
    const scene = cloneSkinned(gltf.scene);
    gltf.scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(gltf.scene, true);
    const scale = LENGTH / (box.getSize(new Vector3()).z || 1);
    scene.scale.setScalar(scale);
    scene.position.copy(box.getCenter(new Vector3()).multiplyScalar(-scale));
    const materials: MeshLambertMaterial[] = [];
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const belly = !Array.isArray(mesh.material) && mesh.material.name === "Bottom";
      const material = new MeshLambertMaterial({
        color: belly ? palette.whaleBelly : palette.whaleBack,
        flatShading: true,
      });
      mesh.material = material;
      mesh.frustumCulled = false;
      materials.push(material);
    });
    const mixer = new AnimationMixer(scene);
    for (const clip of gltf.animations) mixer.clipAction(clip).play();
    return { scene, mixer, materials };
  }, [gltf]);
  useEffect(
    () => () => {
      rig.mixer.stopAllAction();
      for (const material of rig.materials) material.dispose();
    },
    [rig],
  );
  useEffect(() => invalidate(), [invalidate]);

  useFrame((state, delta) => {
    const group = body.current;
    if (group === null) return;
    const now = state.clock.elapsedTime;
    startedAt.current ??= now;
    const t = now - startedAt.current;
    if (t >= seconds * CROSSINGS[1] + SPLASH_SECONDS) {
      onDone();
      return;
    }
    const u = Math.min(1, t / seconds);
    const { y, travel } = leap(u);
    const sin = Math.sin(sighting.heading);
    const cos = Math.cos(sighting.heading);
    group.position.set(sighting.x + sin * travel, y, sighting.z + cos * travel);
    // Nose along the arc: up on the way out, down on the way back in.
    const pitch = Math.atan2(4 * (DEPTH + PEAK) * (1 - 2 * u), SPAN);
    const roll = sighting.twist * ROLL * u * u * (3 - 2 * u);
    group.rotation.set(-pitch, sighting.heading, roll, "YXZ");
    group.visible = u < 1;
    rig.mixer.update(Math.min(delta, 0.1));

    // A ring of foam where it breaks the surface, spreading and fading.
    CROSSINGS.forEach((at, index) => {
      const splash = splashes.current[index];
      if (splash == null) return;
      const age = (t - at * seconds) / SPLASH_SECONDS;
      splash.visible = age >= 0 && age < 1;
      if (!splash.visible) return;
      const where = leap(at).travel;
      splash.position.set(sighting.x + sin * where, WATER_Y + 0.02, sighting.z + cos * where);
      splash.scale.setScalar(LENGTH * (0.4 + 0.8 * age));
      (splash.material as MeshBasicMaterial).opacity = 0.75 * (1 - age);
    });
    drawSoon(state.invalidate, fps);
  });

  return (
    <>
      <group ref={body}>
        <primitive object={rig.scene} />
      </group>
      {CROSSINGS.map((at, index) => (
        <mesh
          key={at}
          ref={(mesh) => {
            splashes.current[index] = mesh;
          }}
          geometry={geometry.shadow}
          rotation-x={-Math.PI / 2}
          visible={false}
        >
          <meshBasicMaterial color={palette.foam} transparent depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}
