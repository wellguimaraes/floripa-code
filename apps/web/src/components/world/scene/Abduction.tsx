import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  type Group,
  type Mesh,
  type MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";

import type { Vec3 } from "../definition/types";
import { CharacterModel } from "./CharacterModel";
import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { type FamilyShades, palette } from "./palette";

const DESCEND = 1;
const BEAM = 2;
const LEAVE = 0.9;
export const ABDUCTION_SECONDS = DESCEND + BEAM + LEAVE;
const HOVER_HEIGHT = 6;
/** The saucer's size for a single character; a wide group gets a wider one. */
const SAUCER_SCALE = 2.6;
const FPS = 30;

export interface AbductedFigure {
  readonly key: string;
  readonly position: Vec3;
  readonly scale: number;
  /** The way the character faced, so the stand-in turns up exactly as it stood. */
  readonly facing: number;
  readonly shades: FamilyShades;
}

const up = new Vector3(0, 1, 0);

/**
 * A saucer drops in over archived characters, beams them all up at once and
 * flies off. Stand-ins of the same model in each character's colours do the
 * rising, since the real ones are gone the moment their threads are archived.
 */
export function Abduction(props: {
  readonly figures: ReadonlyArray<AbductedFigure>;
  readonly onDone: () => void;
}) {
  const { figures, onDone } = props;
  // Hover over the group's middle, high and wide enough to take everyone in.
  const { center, size } = useMemo(() => {
    const middle = new Vector3();
    for (const figure of figures) middle.add(new Vector3(...figure.position));
    middle.divideScalar(Math.max(1, figures.length));
    const reach = Math.max(
      0,
      ...figures.map((figure) =>
        Math.hypot(figure.position[0] - middle.x, figure.position[2] - middle.z),
      ),
    );
    return { center: middle, size: Math.max(SAUCER_SCALE, reach * 0.55) };
  }, [figures]);
  const hover = HOVER_HEIGHT + size;
  // Each beam runs from its character up to the saucer's belly.
  const beams = useMemo(
    () =>
      figures.map((figure) => {
        const from = new Vector3(...figure.position).sub(center);
        const to = new Vector3(0, hover - 0.4 * size, 0);
        const along = to.clone().sub(from);
        return {
          from,
          to,
          middle: from.clone().add(to).multiplyScalar(0.5),
          length: along.length(),
          turn: new Quaternion().setFromUnitVectors(up, along.normalize()),
        };
      }),
    [figures, center, hover, size],
  );

  const saucer = useRef<Group>(null);
  const figureRefs = useRef<Array<Group | null>>([]);
  const beamRefs = useRef<Array<Mesh | null>>([]);
  const startedAt = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  // Draw once more on the way out too: the scene only redraws when asked, so
  // without it the last frame, saucer included, would stay on screen.
  useEffect(() => {
    invalidate();
    return () => invalidate();
  }, [invalidate]);

  useFrame((state) => {
    if (saucer.current === null) return;
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

    // Off to the side and up, shrinking into the distance until it is gone.
    saucer.current.position.set(
      leave * leave * 30,
      hover + (1 - descend) * 10 + leave * leave * 30,
      -leave * leave * 30,
    );
    saucer.current.scale.setScalar(size * (1 - leave));
    saucer.current.rotation.y = t * 2.5;

    const beaming = t > DESCEND && t < DESCEND + BEAM;
    const opacity = beaming ? 0.32 + Math.sin(t * 18) * 0.08 : 0;
    for (const beam of beamRefs.current) {
      if (beam === null) continue;
      beam.visible = beaming;
      (beam.material as MeshBasicMaterial).opacity = opacity;
    }

    // Rise along the beam into the saucer, spinning and shrinking, then vanish inside it.
    figures.forEach((figure, index) => {
      const group = figureRefs.current[index];
      const path = beams[index];
      if (!group || !path) return;
      group.visible = t < DESCEND + BEAM;
      group.position.lerpVectors(path.from, path.to, lift);
      group.rotation.y = figure.facing + lift * Math.PI * 4;
      group.scale.setScalar(figure.scale * (1 - lift * 0.6));
    });

    drawSoon(state.invalidate, FPS);
  });

  return (
    <group position={[center.x, center.y, center.z]}>
      {figures.map((figure, index) => (
        <group
          key={figure.key}
          ref={(group) => {
            figureRefs.current[index] = group;
          }}
          position={beams[index]!.from}
          scale={figure.scale}
          rotation-y={figure.facing}
        >
          <Suspense fallback={null}>
            <CharacterModel pose="stand" shades={figure.shades} isWalking={() => false} />
          </Suspense>
        </group>
      ))}
      {beams.map((beam, index) => (
        <mesh
          key={figures[index]!.key}
          ref={(mesh) => {
            beamRefs.current[index] = mesh;
          }}
          geometry={geometry.cone}
          position={beam.middle}
          quaternion={beam.turn}
          // Point at the saucer, widening toward the ground.
          scale={[1.1, beam.length, 1.1]}
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
      ))}
      <group ref={saucer} position-y={hover + 10} scale={size}>
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
