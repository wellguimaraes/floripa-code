import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { Group } from "three";

import type { WorldArchipelago } from "../definition/types";
import { drawSoon } from "./frames";
import { geometry } from "./geometries";
import { palette } from "./palette";

const WATER_Y = -0.25;
const SWIM_SPEED = 1.1;
const RISE_SECONDS = 0.6;
const DIVE_SECONDS = 0.9;

interface Sighting {
  readonly id: number;
  readonly x: number;
  readonly z: number;
  /** Yaw: facing f swims toward (sin f, cos f). */
  readonly heading: number;
}

/**
 * Now and then a fin surfaces near a random island, swims a little and dives.
 * Only one is up at a time, frames are drawn only while it is, and no new
 * sighting starts while the tab is hidden.
 */
export function SharkSightings(props: {
  /** Island centres in world space and how far their shore reaches. */
  readonly islands: ReadonlyArray<{
    readonly x: number;
    readonly z: number;
    readonly shoreRadius: number;
  }>;
  readonly config: WorldArchipelago["sharks"];
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
      // Nobody is looking: wait for the next turn instead of surfacing.
      if (document.visibilityState !== "visible" || candidates.length === 0) {
        schedule();
        return;
      }
      const island = candidates[Math.floor(Math.random() * candidates.length)]!;
      const angle = Math.random() * Math.PI * 2;
      const [near, far] = config.offshore;
      const distance = island.shoreRadius + near + Math.random() * (far - near);
      // Swim along the shore, one way or the other.
      const along = angle + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      setSighting({
        id: Date.now(),
        x: island.x + Math.cos(angle) * distance,
        z: island.z + Math.sin(angle) * distance,
        heading: Math.atan2(Math.cos(along), Math.sin(along)),
      });
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [sighting, config]);

  return sighting === null ? null : (
    <Shark
      key={sighting.id}
      sighting={sighting}
      seconds={config.surfaceSeconds}
      fps={config.fps}
      onDone={() => setSighting(null)}
    />
  );
}

function Shark(props: {
  readonly sighting: Sighting;
  readonly seconds: number;
  readonly fps: number;
  readonly onDone: () => void;
}) {
  const { sighting, seconds, fps, onDone } = props;
  const fin = useRef<Group>(null);
  const startedAt = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => invalidate(), [invalidate]);

  useFrame((state) => {
    const group = fin.current;
    if (group === null) return;
    const now = state.clock.elapsedTime;
    startedAt.current ??= now;
    const t = now - startedAt.current;
    if (t >= seconds) {
      onDone();
      return;
    }
    // Rise, cruise, then tip forward and sink.
    const rise = Math.min(1, t / RISE_SECONDS);
    const dive = Math.max(0, (t - (seconds - DIVE_SECONDS)) / DIVE_SECONDS);
    const travel = (t - seconds / 2) * SWIM_SPEED;
    group.position.set(
      sighting.x + Math.sin(sighting.heading) * travel,
      WATER_Y - 0.95 * (1 - rise) - 1.1 * dive,
      sighting.z + Math.cos(sighting.heading) * travel,
    );
    group.rotation.set(dive * 0.6, sighting.heading, 0);
    drawSoon(state.invalidate, fps);
  });

  return (
    <group ref={fin}>
      {/* The body, a dark shape just under the surface. */}
      <mesh
        geometry={geometry.shadow}
        position={[0, 0.012, -0.1]}
        rotation-x={-Math.PI / 2}
        scale={[0.7, 2.4, 1]}
      >
        <meshBasicMaterial color={palette.shadow} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <mesh
        geometry={geometry.shadow}
        position={[0, 0.016, -0.55]}
        rotation-x={-Math.PI / 2}
        scale={[0.6, 1.8, 1]}
      >
        <meshBasicMaterial color={palette.foam} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <mesh geometry={geometry.fin} position-y={0.4} rotation-x={-0.35} scale={[0.12, 0.9, 0.55]}>
        <meshLambertMaterial color={palette.sharkFin} flatShading />
      </mesh>
    </group>
  );
}
