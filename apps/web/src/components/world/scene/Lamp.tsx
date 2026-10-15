import { useFrame, useThree } from "@react-three/fiber";
import { useContext, useEffect, useRef } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  type Sprite,
} from "three";

import { keepColors } from "./contrast";
import { geometry } from "./geometries";
import { FadedContext, LitMaterial, TimeOfDayContext } from "./lighting";
import { chain, mergedParts, type Part, scale, translate } from "./merged";
import { palette } from "./palette";

/** The lantern's middle, where the light comes from. */
const LANTERN_Y = 2.75;
/** How far the lamp's pool of light reaches across the ground. */
const POOL_RADIUS = 3.2;
/** Down in the ground by day, roof and all; the island's sand and the sea hide it there. */
const SUNK = -3.4;
const RISE_MS = 1400;
/** Lamps start up to this long after one another, so they don't move in lockstep. */
const STAGGER_MS = 600;

/** A street lamp's post and lantern frame, lit like the rest of the island. */
function lampParts(): ReadonlyArray<Part> {
  const post = palette.lampPost;
  return [
    {
      geometry: geometry.cylinder,
      matrix: chain(translate(0, 0.125, 0), scale(0.14, 0.25, 0.14)),
      color: post,
    },
    {
      geometry: geometry.cylinder,
      matrix: chain(translate(0, 1.4, 0), scale(0.055, 2.3, 0.055)),
      color: post,
    },
    {
      geometry: geometry.box,
      matrix: chain(translate(0, LANTERN_Y - 0.2, 0), scale(0.36, 0.05, 0.36)),
      color: post,
    },
    {
      geometry: geometry.cone,
      matrix: chain(translate(0, LANTERN_Y + 0.29, 0), scale(0.3, 0.22, 0.3)),
      color: post,
      flat: true,
    },
  ];
}

let glow: CanvasTexture | null = null;

/** A soft round glow, bright in the middle and fading to nothing at the edge. */
function glowTexture(): CanvasTexture {
  if (glow !== null) return glow;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  glow = new CanvasTexture(canvas);
  return glow;
}

const noRaycast = () => null;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A street lamp that comes up out of the ground after sunset, lights up, and
 * goes back down at dawn; it stays down on an empty island. Its light is
 * faked, so any number of lamps cost no real lights: a glowing lantern with a
 * halo, and a warm pool added onto the ground beneath.
 */
export function Lamp(props: { readonly seed: number }) {
  const { lampsOn } = useContext(TimeOfDayContext);
  const faded = useContext(FadedContext);
  const on = lampsOn && !faded;
  const invalidate = useThree((state) => state.invalidate);
  const post = useRef<Group>(null);
  const lantern = useRef<MeshBasicMaterial>(null);
  const halo = useRef<Sprite>(null);
  const pool = useRef<Mesh>(null);
  const height = on ? 0 : SUNK;
  // Where the post is headed, and from where; already there on the first draw.
  const move = useRef({ from: height, to: height, startsAt: 0 });

  useEffect(() => {
    const current = post.current?.position.y ?? height;
    if (move.current.to === height) return;
    const delay = ((props.seed % 1000) / 1000) * STAGGER_MS;
    move.current = { from: current, to: height, startsAt: performance.now() + delay };
    invalidate();
  }, [height, props.seed, invalidate]);

  useFrame(() => {
    const { from, to, startsAt } = move.current;
    const t = Math.min(1, Math.max(0, (performance.now() - startsAt) / RISE_MS));
    const y = from + (to - from) * easeInOut(t);
    if (post.current !== null) {
      post.current.position.y = y;
      post.current.visible = y > SUNK + 0.01;
    }
    // Lit once fully up; dark as soon as it starts down.
    const glowing = to === 0 && t >= 1;
    lantern.current?.color.set(glowing ? palette.lampBulb : palette.lampPost);
    if (halo.current !== null) halo.current.visible = glowing;
    if (pool.current !== null) pool.current.visible = glowing;
    if (t < 1) invalidate();
  });

  return (
    <>
      <group ref={post}>
        {mergedParts("lamp", lampParts).map((part) => (
          <mesh key={`${part.color}:${part.flat}`} geometry={part.geometry}>
            <LitMaterial color={part.color} flatShading={part.flat} />
          </mesh>
        ))}
        <mesh
          geometry={geometry.box}
          position-y={LANTERN_Y}
          scale={[0.3, 0.34, 0.3]}
          raycast={noRaycast}
        >
          <meshBasicMaterial ref={lantern} color={palette.lampPost} onUpdate={keepColors} />
        </mesh>
        <sprite ref={halo} position-y={LANTERN_Y} scale={2} raycast={noRaycast} visible={false}>
          <spriteMaterial
            map={glowTexture()}
            color={palette.lampLight}
            blending={AdditiveBlending}
            transparent
            opacity={0.85}
            depthWrite={false}
            onUpdate={keepColors}
          />
        </sprite>
      </group>
      <mesh
        ref={pool}
        geometry={geometry.plane}
        rotation-x={-Math.PI / 2}
        position-y={0.03}
        scale={POOL_RADIUS * 2}
        raycast={noRaycast}
        visible={false}
      >
        <meshBasicMaterial
          map={glowTexture()}
          color={palette.lampLight}
          blending={AdditiveBlending}
          transparent
          opacity={0.8}
          depthWrite={false}
          onUpdate={keepColors}
        />
      </mesh>
    </>
  );
}
