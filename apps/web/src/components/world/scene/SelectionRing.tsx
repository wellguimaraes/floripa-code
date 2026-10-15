import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Color, type Mesh, type MeshBasicMaterial } from "three";

import { keepColors } from "./contrast";
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
const ELSEWHERE = new Color(palette.selection);

/**
 * The selected character's ring, with ripples spreading out of it. White shows
 * poorly on pale sand, so while `onSand` says the character stands on sand the
 * ring takes `sandColor`, the character's own colour. Keeps frames coming at
 * `fps` while it is shown.
 */
export function SelectionRing(props: {
  readonly fps: number;
  readonly sandColor: string;
  readonly onSand: () => boolean;
}) {
  const onSand = useMemo(() => new Color(props.sandColor), [props.sandColor]);
  const ring = useRef<Mesh>(null);
  const ripples = useRef<Array<Mesh | null>>([]);
  useFrame((state) => {
    const color = props.onSand() ? onSand : ELSEWHERE;
    for (const mesh of [ring.current, ...ripples.current]) {
      if (mesh !== null) (mesh.material as MeshBasicMaterial).color.copy(color);
    }
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
      <mesh ref={ring} geometry={geometry.ring}>
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

/** Keeps its colours at any contrast, like the character it marks. */
function RingMaterial({ opacity }: { readonly opacity: number }) {
  return (
    <meshBasicMaterial
      color={ELSEWHERE}
      transparent
      opacity={opacity}
      depthWrite={false}
      onUpdate={keepColors}
    />
  );
}
