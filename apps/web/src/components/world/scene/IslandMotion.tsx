import { type ThreeElements, useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useRef, useState } from "react";
import { type Group, Matrix4, type Object3D, Vector3 } from "three";

import type { Vec3 } from "../definition/types";

/** How long an island takes to glide to a new spot in the archipelago. */
export const ISLAND_MOVE_MS = 600;
/** How long an island takes to sink under the sea or rise from it. */
export const ISLAND_SINK_MS = 400;
// Deep enough to take the sign's lamps and the tallest prop under the water.
const SINK_DEPTH = 14;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const target = new Vector3();
const SETTLES_AT = "islandSettlesAt";
const unplaced = new Matrix4();
const settled = new Matrix4();

/**
 * `object`'s world matrix as it will be once its island stops moving and stands above the
 * water, so framing the camera mid-glide aims at where the islands end up, not where they pass.
 */
export function settledMatrixWorld(object: Object3D, out: Matrix4): Matrix4 {
  object.updateWorldMatrix(true, false);
  out.copy(object.matrixWorld);
  for (let island = object.parent; island !== null; island = island.parent) {
    const at = island.userData[SETTLES_AT] as Vec3 | undefined;
    if (at === undefined) continue;
    settled.makeTranslation(at[0], at[1], at[2]);
    if (island.parent !== null) settled.premultiply(island.parent.matrixWorld);
    return out.premultiply(unplaced.copy(island.matrixWorld).invert()).premultiply(settled);
  }
  return out;
}

/**
 * An island's group that glides to a new `position` instead of jumping there,
 * sinks under the sea while `leaving`, and, with `appear` on mount, rises from
 * it once the islands around it have moved aside. Everything on the island
 * moves with it.
 */
export function IslandMotion({
  position,
  leaving,
  appear,
  onSunk,
  children,
  ...group
}: Omit<ThreeElements["group"], "position" | "visible"> & {
  readonly position: Vec3;
  readonly leaving: boolean;
  /** Read on mount only. */
  readonly appear: boolean;
  /** Called once it is all the way under the water (`true`) or back up (`false`). */
  readonly onSunk?: (sunk: boolean) => void;
}) {
  const ref = useRef<Group>(null);
  const invalidate = useThree((state) => state.invalidate);
  const [x, y, z] = position;
  const [initial] = useState(() => {
    const appears = appear && !reducedMotion();
    return {
      position: [x, appears ? y - SINK_DEPTH : y, z] as [number, number, number],
      appears,
      // Waits under the water while the others make room.
      sink: appears ? { from: 1, to: 0, at: performance.now() + ISLAND_MOVE_MS } : null,
    };
  });
  // How far under the water it is, from 0 (standing) to 1 (sunk), and where that is headed.
  const sunk = useRef(initial.appears ? 1 : 0);
  const sink = useRef<{ readonly from: number; readonly to: number; readonly at: number } | null>(
    initial.sink,
  );
  const glide = useRef<{ readonly from: Vector3; readonly at: number } | null>(null);
  // Where the glide has it, before sinking.
  const place = useRef(new Vector3(x, y, z));

  useLayoutEffect(() => {
    const island = ref.current;
    if (island === null) return;
    island.userData[SETTLES_AT] = [x, y, z];
    if (place.current.equals(target.set(x, y, z))) return;
    if (reducedMotion()) {
      place.current.set(x, y, z);
      island.position.set(x, y - sunk.current * SINK_DEPTH, z);
    } else {
      glide.current = { from: place.current.clone(), at: performance.now() };
    }
    invalidate();
  }, [x, y, z, invalidate]);

  useLayoutEffect(() => {
    const to = leaving ? 1 : 0;
    if ((sink.current?.to ?? sunk.current) !== to) {
      sink.current = { from: sunk.current, to, at: performance.now() };
    }
    // Also on mount, so an appearing island starts its wait even when nothing else moves.
    if (sink.current !== null) invalidate();
  }, [leaving, invalidate]);

  useFrame((state) => {
    const island = ref.current;
    if (island === null || (glide.current === null && sink.current === null)) return;
    const now = performance.now();
    const moving = glide.current;
    if (moving !== null) {
      const t = Math.min(1, (now - moving.at) / ISLAND_MOVE_MS);
      place.current.lerpVectors(moving.from, target.set(x, y, z), easeInOut(t));
      if (t < 1) state.invalidate();
      else glide.current = null;
    }
    const sinking = sink.current;
    if (sinking !== null) {
      const t = reducedMotion() ? 1 : Math.max(0, Math.min(1, (now - sinking.at) / ISLAND_SINK_MS));
      sunk.current = sinking.from + (sinking.to - sinking.from) * easeInOut(t);
      if (t < 1) state.invalidate();
      else {
        sink.current = null;
        onSunk?.(sinking.to === 1);
      }
    }
    island.position.copy(place.current);
    island.position.y -= sunk.current * SINK_DEPTH;
    // Out of sight under the water, it stops drawing.
    island.visible = sunk.current < 1;
  });

  return (
    <group ref={ref} position={initial.position} visible={!initial.appears} {...group}>
      {children}
    </group>
  );
}
