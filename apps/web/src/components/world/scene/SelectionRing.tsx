import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, MeshBasicMaterial } from "three";

import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { palette } from "./palette";

/**
 * Height of the ring, in the character's units: just over the towels (0.032
 * world units), even for a kid, so only taller props and the figure hide it.
 */
const RING_HEIGHT = 0.05;
const RIPPLES = 2;
const PERIOD_SECONDS = 1.6;
/** How far a ripple grows, as a multiple of the ring's size. */
const SPREAD = 0.8;
const OPACITY = 0.8;

/**
 * The selected character's ring, with ripples spreading out of it. Keeps
 * frames coming at `fps` while it is shown.
 */
export function SelectionRing(props: { readonly fps: number }) {
  const ripples = useRef<Array<Mesh | null>>([]);
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    ripples.current.forEach((ripple, index) => {
      if (ripple === null) return;
      const phase = (time / PERIOD_SECONDS + index / RIPPLES) % 1;
      const scale = 1 + phase * SPREAD;
      ripple.scale.set(scale, scale, 1);
      (ripple.material as MeshBasicMaterial).opacity = OPACITY * (1 - phase);
    });
    drawSoon(state.invalidate, props.fps);
  });
  return (
    <group rotation-x={-Math.PI / 2} position-y={RING_HEIGHT}>
      <mesh geometry={geometry.ring}>
        <RingMaterial opacity={OPACITY} />
      </mesh>
      {Array.from({ length: RIPPLES }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            ripples.current[index] = mesh;
          }}
          geometry={geometry.ring}
        >
          <RingMaterial opacity={0} />
        </mesh>
      ))}
    </group>
  );
}

function RingMaterial({ opacity }: { readonly opacity: number }) {
  return (
    <meshBasicMaterial color={palette.selection} transparent opacity={opacity} depthWrite={false} />
  );
}
