import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  type Mesh,
  type MeshBasicMaterial,
} from "three";

import { drawSoon } from "./frames";
import { palette } from "./palette";

const RINGS = 3;
const PERIOD_SECONDS = 3.2;
const SPREAD = 6;
/** Where a ring starts, from the shallows' edge: a little under them, so it slides out. */
const START = -0.4;
/** A ring's width, as a share of its distance from the centre. */
const THICKNESS = 0.025;
/** A wavy ring's width, thinner so its crests read as a line. */
const WAVY_THICKNESS = 0.012;
/** Enough for a wavy ring's crests to stay round. */
const SEGMENTS = 192;
/** A wavy ring's crests round the island, and how far each swings in and out. */
const WAVES = 18;
const WAVE_HEIGHT = 0.18;
/** How long a stopping ripple takes to fade out, and the frame rate it fades at. */
const FADE_SECONDS = 1.2;
const FADE_FPS = 30;

/**
 * Rings of foam spreading out from the shore, each one the outline of the
 * island's outer shallows grown outward. They sit just above the sea but
 * under the shallows, so they rise out from beneath the turquoise bands.
 * Draws only while frames are requested; the world's ambient ticker asks for
 * them while any island ripples.
 */
export function Ripple(props: {
  readonly center: readonly [x: number, z: number];
  /** The radius of the outer shallows' circle. */
  readonly radius: number;
  /** How far the shallows' edge sits outside that circle at an angle from +z toward +x. */
  readonly edge: (angle: number) => number;
  /** The rings wobble in and out round the island, e.g. while it sits idle. */
  readonly wavy: boolean;
  /** The ripple has stopped: it fades out, then calls `onGone`. */
  readonly leaving: boolean;
  readonly onGone: () => void;
}) {
  const { radius, edge, wavy, leaving, onGone } = props;
  const rings = useRef<Array<Mesh | null>>([]);
  // When the fade began, on the scene's clock; null while the ripple is on.
  const fadeStart = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  // The world stops asking for ripple frames once none is on, so the fade asks for its own.
  useEffect(() => {
    if (leaving) invalidate();
  }, [leaving, invalidate]);
  const outline = useMemo(
    () =>
      Array.from({ length: SEGMENTS + 1 }, (_, index) => {
        const angle = (index / SEGMENTS) * Math.PI * 2;
        return { angle, sin: Math.sin(angle), cos: Math.cos(angle), edge: edge(angle) };
      }),
    [edge],
  );
  const geometries = useMemo(
    () =>
      Array.from({ length: RINGS }, () => {
        const ring = new BufferGeometry();
        ring.setAttribute(
          "position",
          new Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * 2 * 3), 3),
        );
        const indices: number[] = [];
        for (let index = 0; index < SEGMENTS; index += 1) {
          const inner = index * 2;
          indices.push(inner, inner + 1, inner + 2, inner + 1, inner + 3, inner + 2);
        }
        ring.setIndex(indices);
        return ring;
      }),
    [],
  );
  useEffect(() => () => geometries.forEach((ring) => ring.dispose()), [geometries]);
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (!leaving) fadeStart.current = null;
    else fadeStart.current ??= time;
    const fade = fadeStart.current === null ? 1 : 1 - (time - fadeStart.current) / FADE_SECONDS;
    if (fade <= 0) {
      onGone();
      return;
    }
    if (leaving) drawSoon(state.invalidate, FADE_FPS);
    rings.current.forEach((ring, index) => {
      if (ring === null) return;
      const phase = (time / PERIOD_SECONDS + index / RINGS) % 1;
      const grown = radius + START + phase * SPREAD;
      const half = ((wavy ? WAVY_THICKNESS : THICKNESS) * grown) / 2;
      const positions = geometries[index]!.getAttribute("position") as Float32BufferAttribute;
      outline.forEach((point, segment) => {
        // A wavy ring's crests drift round as it spreads.
        const wave = wavy ? WAVE_HEIGHT * Math.sin(point.angle * WAVES + phase * Math.PI * 2) : 0;
        const outer = grown + point.edge + wave + half;
        const inner = grown + point.edge + wave - half;
        positions.setXYZ(segment * 2, point.sin * inner, 0, point.cos * inner);
        positions.setXYZ(segment * 2 + 1, point.sin * outer, 0, point.cos * outer);
      });
      positions.needsUpdate = true;
      (ring.material as MeshBasicMaterial).opacity = 0.9 * (1 - phase) * fade;
    });
  });
  return (
    <group position={[props.center[0], -0.245, props.center[1]]}>
      {geometries.map((ring, index) => (
        <mesh
          key={index}
          ref={(mesh) => {
            rings.current[index] = mesh;
          }}
          geometry={ring}
          frustumCulled={false}
        >
          <meshBasicMaterial
            color={palette.foam}
            transparent
            opacity={0}
            depthWrite={false}
            side={DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
