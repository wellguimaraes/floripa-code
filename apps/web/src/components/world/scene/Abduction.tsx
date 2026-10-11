import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { AdditiveBlending, type Group, type Mesh, type MeshBasicMaterial } from "three";

import type { Vec3 } from "../definition/types";
import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { palette } from "./palette";

const DESCEND = 0.8;
const BEAM = 1.8;
const LEAVE = 0.8;
export const ABDUCTION_SECONDS = DESCEND + BEAM + LEAVE;
const HOVER_HEIGHT = 3.4;
const FPS = 30;

/**
 * A saucer drops in over an archived character, beams it up and flies off.
 * A stand-in figure in the character's colours does the rising, since the
 * real one is gone the moment the thread is archived.
 */
export function Abduction(props: {
  readonly position: Vec3;
  readonly scale: number;
  readonly shades: { readonly light: string; readonly base: string; readonly dark: string };
  readonly onDone: () => void;
}) {
  const { position, scale, shades, onDone } = props;
  const saucer = useRef<Group>(null);
  const figure = useRef<Group>(null);
  const beam = useRef<Mesh>(null);
  const startedAt = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => invalidate(), [invalidate]);

  useFrame((state) => {
    if (saucer.current === null || figure.current === null || beam.current === null) return;
    const now = state.clock.elapsedTime;
    startedAt.current ??= now;
    const t = now - startedAt.current;
    if (t >= ABDUCTION_SECONDS) {
      onDone();
      return;
    }
    const ease = (x: number) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
    const descend = ease(t / DESCEND);
    const lift = ease((t - DESCEND) / BEAM);
    const leave = Math.max(0, (t - DESCEND - BEAM) / LEAVE);

    saucer.current.position.set(
      leave * leave * 6,
      HOVER_HEIGHT + (1 - descend) * 6 + leave * leave * 8,
      -leave * leave * 6,
    );
    saucer.current.rotation.y = t * 4;

    const beaming = t > DESCEND && t < DESCEND + BEAM;
    beam.current.visible = beaming;
    (beam.current.material as MeshBasicMaterial).opacity = beaming
      ? 0.35 + Math.sin(t * 18) * 0.08
      : 0;

    // Rise into the saucer, spinning and shrinking, then vanish inside it.
    figure.current.visible = t < DESCEND + BEAM;
    figure.current.position.y = lift * (HOVER_HEIGHT - 0.4);
    figure.current.rotation.y = lift * Math.PI * 4;
    figure.current.scale.setScalar(scale * (1 - lift * 0.6));

    drawSoon(state.invalidate, FPS);
  });

  return (
    <group position={position as [number, number, number]}>
      <group ref={figure} scale={scale}>
        <mesh geometry={geometry.leg} position={[-0.1, 0.16, 0]}>
          <meshLambertMaterial color={shades.dark} />
        </mesh>
        <mesh geometry={geometry.leg} position={[0.1, 0.16, 0]}>
          <meshLambertMaterial color={shades.dark} />
        </mesh>
        <mesh geometry={geometry.torso} position-y={0.6}>
          <meshLambertMaterial color={shades.base} />
        </mesh>
        <mesh geometry={geometry.head} position-y={1.12}>
          <meshLambertMaterial color={shades.light} />
        </mesh>
      </group>
      <mesh
        ref={beam}
        geometry={geometry.cone}
        position-y={HOVER_HEIGHT / 2}
        scale={[1.1, HOVER_HEIGHT, 1.1]}
        visible={false}
        renderOrder={6}
      >
        <meshBasicMaterial
          color={palette.ufoBeam}
          transparent
          opacity={0}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </mesh>
      <group ref={saucer} position-y={HOVER_HEIGHT + 6}>
        <mesh geometry={geometry.head} scale={[4.2, 0.9, 4.2]}>
          <meshLambertMaterial color={palette.ufoHull} />
        </mesh>
        <mesh geometry={geometry.head} position-y={0.18} scale={[1.6, 1.3, 1.6]}>
          <meshBasicMaterial color={palette.ufoDome} transparent opacity={0.8} />
        </mesh>
        {[0, 1, 2, 3, 4, 5].map((index) => {
          const angle = (index / 6) * Math.PI * 2;
          return (
            <mesh
              key={angle}
              geometry={geometry.eye}
              position={[Math.cos(angle) * 0.82, -0.06, Math.sin(angle) * 0.82]}
              scale={1.8}
            >
              <meshBasicMaterial color={palette.ufoLight} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}
