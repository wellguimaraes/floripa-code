import { useFrame, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type OrthographicCamera,
  ShaderMaterial,
  Vector3,
} from "three";

import { seededRandom } from "../engine/hash";
import { palette } from "./palette";

const DROPS = 1600;
const SPLASHES = 500;
/** The sea takes most of the view, so it gets its own, denser splashes. */
const SEA_SPLASHES = 1400;
/** Frames per second while it rains; the drops are animated on the GPU, so this is all it costs. */
const FPS = 30;
/**
 * The rain fills a box around the middle of the view, as wide as the view
 * and then some, so it reads the same at any zoom. Heights, lengths and speeds
 * below are shares of that box's width.
 */
const COVER = 1.3;
/** How high the drops start, and how long each streak is. */
const FALL_HEIGHT = 0.35;
const DROP_LENGTH = 0.012;
/** Falls from top to ground per second. */
const FALL_RATE = 0.35;
/** How far a drop drifts sideways per unit it falls, toward the camera's right. */
const WIND: readonly [number, number] = [0.12, -0.12];
/** Splashes per spot per second; each lasts a short part of that cycle. */
const SPLASH_RATE = 0.45;
/** Just above the lawn, the island's highest ground, so splashes show on it too. */
const SPLASH_HEIGHT = 0.17;
/** Just above the sea (see the water plane in WorldCanvas); islands hide the ones under them. */
const SEA_HEIGHT = -0.24;
/** Sea rings open a little wider than those on land. */
const SEA_SPLASH_SCALE = 1.3;

/**
 * Rain over the world: thin streaks falling at a slant, and small rings
 * splashing on the ground. One draw each, animated in the shaders; only drawn
 * while `amount` (0 to 1, see `useRainAmount`) is above 0, fading with it.
 */
export function Rain(props: { readonly amount: number }) {
  const { amount } = props;
  const invalidate = useThree((state) => state.invalidate);

  // Keeps frames coming while it rains, paused in a background tab.
  useEffect(() => {
    if (amount <= 0) return;
    let timer: number | null = null;
    const sync = () => {
      const visible = document.visibilityState === "visible";
      if (visible && timer === null) timer = window.setInterval(() => invalidate(), 1000 / FPS);
      if (!visible && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [amount, invalidate]);

  useFrame(({ camera, gl }) => {
    if (amount <= 0) return;
    const { drops, splashes, seaSplashes } = rainParts();
    const { center, size } = viewBox(camera as OrthographicCamera);
    const time = performance.now() / 1000;
    for (const material of [drops, splashes, seaSplashes]) {
      material.uniforms.time!.value = time;
      material.uniforms.size!.value = size;
      material.uniforms.center!.value.copy(center);
      material.uniforms.amount!.value = amount;
    }
    for (const material of [splashes, seaSplashes]) {
      material.uniforms.pixelsPerUnit!.value = camera.zoom * gl.getPixelRatio();
    }
  });

  if (amount <= 0) return null;
  const { drops, splashes, seaSplashes, dropGeometry, splashGeometry, seaGeometry } = rainParts();
  return (
    <>
      <lineSegments geometry={dropGeometry} material={drops} frustumCulled={false} />
      <points geometry={splashGeometry} material={splashes} frustumCulled={false} />
      <points geometry={seaGeometry} material={seaSplashes} frustumCulled={false} />
    </>
  );
}

let parts: {
  readonly drops: ShaderMaterial;
  readonly splashes: ShaderMaterial;
  readonly seaSplashes: ShaderMaterial;
  readonly dropGeometry: BufferGeometry;
  readonly splashGeometry: BufferGeometry;
  readonly seaGeometry: BufferGeometry;
} | null = null;

/** Built on the first rain and kept: the world has one sky. */
function rainParts() {
  parts ??= {
    drops: dropsMaterial(),
    splashes: splashesMaterial(SPLASH_HEIGHT, 1),
    seaSplashes: splashesMaterial(SEA_HEIGHT, SEA_SPLASH_SCALE),
    dropGeometry: dropsGeometry(),
    splashGeometry: splashesGeometry(SPLASHES, 2),
    seaGeometry: splashesGeometry(SEA_SPLASHES, 3),
  };
  return parts;
}

const ground = new Vector3();
const forward = new Vector3();

/** Where the middle of the view meets the ground, and how wide a box covers the view there. */
export function viewBox(camera: OrthographicCamera): { center: Vector3; size: number } {
  camera.getWorldDirection(forward);
  const along = forward.y === 0 ? 0 : -camera.position.y / forward.y;
  ground.copy(camera.position).addScaledVector(forward, along);
  const width = (camera.right - camera.left) / camera.zoom;
  // The ground runs away from the camera, so the view covers more of it top to bottom.
  const depth = (camera.top - camera.bottom) / camera.zoom / Math.max(0.3, -forward.y);
  return { center: ground, size: Math.max(width, depth) * COVER };
}

function dropsGeometry(): BufferGeometry {
  const random = seededRandom(1);
  const seeds = new Float32Array(DROPS * 2 * 3);
  const tips = new Float32Array(DROPS * 2);
  for (let drop = 0; drop < DROPS; drop += 1) {
    const seed = [random() - 0.5, random() - 0.5, random()];
    seeds.set(seed, drop * 6);
    seeds.set(seed, drop * 6 + 3);
    tips[drop * 2 + 1] = 1;
  }
  const geometry = new BufferGeometry();
  // three needs a position attribute to draw; the shader places every point itself.
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(DROPS * 2 * 3), 3));
  geometry.setAttribute("seed", new Float32BufferAttribute(seeds, 3));
  geometry.setAttribute("tip", new Float32BufferAttribute(tips, 1));
  return geometry;
}

function splashesGeometry(count: number, seed: number): BufferGeometry {
  const random = seededRandom(seed);
  const seeds = new Float32Array(count * 3);
  for (let splash = 0; splash < count; splash += 1) {
    seeds.set([random() - 0.5, random() - 0.5, random()], splash * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("seed", new Float32BufferAttribute(seeds, 3));
  return geometry;
}

const sharedUniforms = () => ({
  time: { value: 0 },
  size: { value: 1 },
  center: { value: new Vector3() },
  amount: { value: 0 },
  color: { value: new Color(palette.rain) },
});

function dropsMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: sharedUniforms(),
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 seed;
      attribute float tip;
      uniform float time;
      uniform float size;
      uniform vec3 center;
      varying float vTip;
      void main() {
        // 1 at the top of the fall, 0 on the ground.
        float height = fract(seed.z - time * ${FALL_RATE.toFixed(3)});
        float y = (height * ${FALL_HEIGHT.toFixed(3)} + tip * ${DROP_LENGTH.toFixed(3)}) * size;
        vec2 drift = vec2(${WIND[0].toFixed(3)}, ${WIND[1].toFixed(3)}) * y;
        vec3 world = center + vec3(seed.x * size + drift.x, y, seed.y * size + drift.y);
        vTip = tip;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float amount;
      varying float vTip;
      void main() {
        // Brightest at the leading (lower) end, fading up the streak.
        gl_FragColor = vec4(color, (1.0 - vTip * 0.8) * 0.32 * amount);
      }
    `,
  });
}

/** Rings at `height`, opening `scale` times the usual size. */
function splashesMaterial(height: number, scale: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { ...sharedUniforms(), pixelsPerUnit: { value: 1 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec3 seed;
      uniform float time;
      uniform float size;
      uniform vec3 center;
      uniform float pixelsPerUnit;
      varying float vAge;
      void main() {
        // Each spot splashes once a cycle, then rests: the ring lives for the first quarter.
        float age = fract(seed.z + time * ${SPLASH_RATE.toFixed(3)}) / 0.25;
        vAge = age;
        vec3 world = center + vec3(seed.x * size, ${height.toFixed(3)}, seed.y * size);
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        gl_PointSize = age < 1.0 ? mix(0.1, 0.55, age) * ${scale.toFixed(3)} * pixelsPerUnit : 0.0;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      uniform float amount;
      varying float vAge;
      void main() {
        if (vAge >= 1.0) discard;
        // A ring lying on the ground: squashed top to bottom, as the camera looks down at it.
        vec2 at = gl_PointCoord * 2.0 - 1.0;
        at.y *= 1.8;
        float distance = length(at);
        float ring = smoothstep(0.65, 0.8, distance) * (1.0 - smoothstep(0.85, 1.0, distance));
        if (ring <= 0.0) discard;
        gl_FragColor = vec4(color, ring * (1.0 - vAge) * 0.35 * amount);
      }
    `,
  });
}
