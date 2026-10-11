import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh, MeshBasicMaterial } from "three";

import { geometry } from "./geometries";
import { palette } from "./palette";

const RINGS = 3;
const PERIOD_SECONDS = 2.4;
const SPREAD = 3.2;

/**
 * Rings of foam spreading out from the shore. Draws only while frames are
 * requested; the world's ambient ticker asks for them while any island ripples.
 */
export function Ripple(props: {
  readonly center: readonly [x: number, z: number];
  readonly radius: number;
}) {
  const rings = useRef<Array<Mesh | null>>([]);
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    rings.current.forEach((ring, index) => {
      if (ring === null) return;
      const phase = (time / PERIOD_SECONDS + index / RINGS) % 1;
      const scale = props.radius + phase * SPREAD;
      ring.scale.set(scale, scale, 1);
      (ring.material as MeshBasicMaterial).opacity = 0.9 * (1 - phase);
    });
  });
  return (
    <group position={[props.center[0], -0.235, props.center[1]]} rotation-x={-Math.PI / 2}>
      {Array.from({ length: RINGS }, (_, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            rings.current[index] = mesh;
          }}
          geometry={geometry.ripple}
          scale={props.radius}
        >
          <meshBasicMaterial color={palette.foam} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
