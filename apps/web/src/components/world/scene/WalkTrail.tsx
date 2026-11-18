import { useLayoutEffect, useMemo, useRef } from "react";
import { type InstancedMesh, Object3D } from "three";

import type { Vec3 } from "../definition/types";
import { useWorldHour } from "../worldTimeStore";
import { keepColors } from "./contrast";
import { geometry } from "./geometries";
import type { Ground } from "./shadows";

/** Dash length, gap, and width, in world units. */
const DASH_LENGTH = 0.22;
const DASH_GAP = 0.16;
const DASH_WIDTH = 0.07;
const DASH_SPACING = DASH_LENGTH + DASH_GAP;
/** Lifts the dashes off the ground, so they never flicker into it. */
const DASH_LIFT = 0.03;
/** From this hour until `DARK_UNTIL` the dashes are white, to stand out from the dimmed island. */
const DARK_FROM = 16;
const DARK_UNTIL = 9;
const DARK_COLOR = "#ffffff";
const dash = new Object3D();

/**
 * A dashed line along the whole of a walk, from where it began to where it ends, in the
 * character's family colour by day and white from late afternoon on. Laid once per path.
 */
export function WalkTrail(props: {
  /** Where the walk began, then every point it passes, ending at the destination. */
  readonly path: ReadonlyArray<Vec3>;
  readonly ground: Ground;
  readonly color: string;
}) {
  const { path, ground } = props;
  const hour = useWorldHour();
  const color = hour >= DARK_FROM || hour < DARK_UNTIL ? DARK_COLOR : props.color;
  const mesh = useRef<InstancedMesh>(null);
  const dashes = useMemo(() => layDashes(path), [path]);

  useLayoutEffect(() => {
    const target = mesh.current;
    if (target === null) return;
    dashes.forEach(({ x, y, z, angle }, index) => {
      dash.position.set(x, y + ground(x, z) + DASH_LIFT, z);
      // Laid flat, then turned along the path: the plane's x runs along the dash.
      dash.rotation.set(-Math.PI / 2, angle, 0, "YXZ");
      dash.scale.set(DASH_LENGTH, DASH_WIDTH, 1);
      dash.updateMatrix();
      target.setMatrixAt(index, dash.matrix);
    });
    target.instanceMatrix.needsUpdate = true;
  }, [dashes, ground]);

  if (dashes.length === 0) return null;
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry.plane, undefined, dashes.length]}
      frustumCulled={false}
      raycast={() => {}}
    >
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.7}
        depthWrite={false}
        onUpdate={keepColors}
      />
    </instancedMesh>
  );
}

/** Dash centres, every `DASH_SPACING` back from the end of the path. */
function layDashes(path: ReadonlyArray<Vec3>) {
  const segments: Array<{ from: Vec3; to: Vec3; length: number }> = [];
  for (let index = path.length - 1; index > 0; index--) {
    const to = path[index]!;
    const from = path[index - 1]!;
    const length = Math.hypot(to[0] - from[0], to[2] - from[2]);
    if (length > 1e-4) segments.push({ from, to, length });
  }
  const dashes: Array<{ x: number; y: number; z: number; angle: number }> = [];
  // Walking back from the end: `walked` is how far back each segment's end lies.
  let walked = 0;
  let next = DASH_LENGTH / 2;
  for (const { from, to, length } of segments) {
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    const angle = Math.atan2(-dz, dx);
    while (next <= walked + length) {
      const t = 1 - (next - walked) / length;
      dashes.push({
        x: from[0] + dx * t,
        y: from[1] + (to[1] - from[1]) * t,
        z: from[2] + dz * t,
        angle,
      });
      next += DASH_SPACING;
    }
    walked += length;
  }
  return dashes;
}
