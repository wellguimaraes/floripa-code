import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import {
  type AmbientLight,
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type Mesh,
  MeshBasicMaterial,
  type OrthographicCamera,
  Vector3,
} from "three";

import { palette } from "./palette";
import { viewBox } from "./Rain";

/** Seconds between strikes, picked at random in this range. */
const GAP_SECONDS: readonly [number, number] = [6, 16];
/** How bright the whole scene flashes at the peak of a strike. */
const FLASH_LIGHT = 2.2;
/** How far the sky lightens toward white at the peak. */
const FLASH_SKY = 0.55;
/** The bolt shows only for the first part of the flash. */
const BOLT_MS = 380;
const FLASH_MS = 650;
/** The bolt's width, and how far it zigzags, as shares of the view box (see `viewBox`). */
const BOLT_WIDTH = 0.004;
const BOLT_JAG = 0.025;
/** From this high, so it starts off the top of the view, down to the sea. */
const BOLT_TOP = 0.55;
const SEA = -0.25;

/**
 * Lightning while `active`: every several seconds a jagged bolt strikes
 * somewhere in view, and the whole scene and sky flash with it, twice in
 * quick succession. The flash light stays in the scene at zero between
 * strikes, so materials never recompile. Relies on the rain for frames.
 */
export function Lightning(props: { readonly active: boolean }) {
  const { active } = props;
  const flash = useRef<AmbientLight>(null);
  const bolt = useRef<Mesh>(null);
  const strike = useRef({ at: -Infinity, next: 0 });
  // The sky as it was before the flash, to put back after.
  const sky = useRef<Color | null>(null);

  useFrame(({ camera, scene }) => {
    const now = performance.now();
    const state = strike.current;
    // The first strike comes at once, so turning the storm on shows it.
    if (active && state.next === 0) state.next = now;
    if (active && now >= state.next) {
      state.at = now;
      state.next = now + gap();
      if (bolt.current !== null) {
        bolt.current.geometry.dispose();
        bolt.current.geometry = boltGeometry(camera as OrthographicCamera);
      }
    }
    if (!active) state.next = 0;

    const since = now - state.at;
    const strength = since < FLASH_MS ? flashAt(since) : 0;
    if (flash.current !== null) flash.current.intensity = strength * FLASH_LIGHT;
    if (bolt.current !== null) {
      bolt.current.visible = since < BOLT_MS;
      (bolt.current.material as MeshBasicMaterial).opacity = Math.min(1, strength * 1.6);
    }
    const background = scene.background instanceof Color ? scene.background : null;
    if (background !== null) {
      if (strength > 0) {
        sky.current ??= background.clone();
        background.copy(sky.current).lerp(white, strength * FLASH_SKY);
      } else if (sky.current !== null) {
        background.copy(sky.current);
        sky.current = null;
      }
    }
  });

  return (
    <>
      <ambientLight ref={flash} color={palette.lightning} intensity={0} />
      <mesh ref={bolt} visible={false} frustumCulled={false} renderOrder={2}>
        <meshBasicMaterial
          color={palette.lightning}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}

const white = new Color(1, 1, 1);

const gap = () => (GAP_SECONDS[0] + Math.random() * (GAP_SECONDS[1] - GAP_SECONDS[0])) * 1000;

/** A strike's brightness `ms` in: a sharp flash, a dip, a second flicker, then dark. */
function flashAt(ms: number): number {
  const pulse = (start: number, length: number) => {
    const t = (ms - start) / length;
    return t < 0 || t > 1 ? 0 : (1 - t) ** 2;
  };
  return Math.min(1, pulse(0, 160) + 0.8 * pulse(230, 380));
}

const right = new Vector3();
const forward = new Vector3();

/**
 * A fresh bolt somewhere in view: a zigzag from the sky down to the sea with
 * one fork, built as flat ribbons facing the camera.
 */
function boltGeometry(camera: OrthographicCamera): BufferGeometry {
  const { center, size } = viewBox(camera);
  camera.getWorldDirection(forward);
  right.crossVectors(forward, camera.up).normalize();
  const start = center
    .clone()
    .add(new Vector3((Math.random() - 0.5) * 0.6 * size, 0, (Math.random() - 0.5) * 0.6 * size));
  const top = BOLT_TOP * size;
  const main = zigzag(start.clone().setY(top), start.clone().setY(SEA), 14, size);
  const forkFrom = main[5]!;
  const forkTo = forkFrom
    .clone()
    .addScaledVector(right, (Math.random() < 0.5 ? -1 : 1) * 0.08 * size)
    .setY(forkFrom.y - 0.18 * size);
  const fork = zigzag(forkFrom, forkTo, 6, size);

  const positions: number[] = [];
  const indices: number[] = [];
  const ribbon = (points: ReadonlyArray<Vector3>, width: number) => {
    const first = positions.length / 3;
    points.forEach((point, index) => {
      // Tapers toward the tip.
      const half = (width * size * (1 - (index / points.length) * 0.6)) / 2;
      const a = point.clone().addScaledVector(right, -half);
      const b = point.clone().addScaledVector(right, half);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      if (index > 0) {
        const at = first + index * 2;
        indices.push(at - 2, at - 1, at, at - 1, at + 1, at);
      }
    });
  };
  ribbon(main, BOLT_WIDTH);
  ribbon(fork, BOLT_WIDTH * 0.6);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** `segments` steps from `from` to `to`, each nudged sideways at random. */
function zigzag(from: Vector3, to: Vector3, segments: number, size: number): Vector3[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const point = from.clone().lerp(to, index / segments);
    if (index === 0 || index === segments) return point;
    return point.addScaledVector(right, (Math.random() - 0.5) * 2 * BOLT_JAG * size);
  });
}
