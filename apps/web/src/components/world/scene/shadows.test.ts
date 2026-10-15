import { BoxGeometry, Matrix4 } from "three";
import { describe, expect, it } from "vite-plus/test";

import { castShadows } from "./shadows";
import type { Direction } from "./daylight";

/** High and to the camera's side, as at midday. */
const SUN: Direction = [6, 14, 9];
/** How far the shadow slides along x and z per unit of height. */
const slideX = SUN[0] / SUN[1];
const slideZ = SUN[2] / SUN[1];

describe("castShadows", () => {
  it("lays a raised box's shadow on the ground, away from the sun", () => {
    // A unit box floating with its bottom 1.4 up: the sun pushes its shadow
    // along -x and -z by its slide per unit of height.
    const box = {
      geometry: new BoxGeometry(1, 1, 1),
      matrix: new Matrix4().makeTranslation(0, 1.9, 0),
    };
    const shadow = castShadows("test:box", () => [box], SUN)!;
    shadow.computeBoundingBox();
    const { min, max } = shadow.boundingBox!;
    expect(min.y).toBe(0);
    expect(max.y).toBe(0);
    expect(min.x).toBeCloseTo(-0.5 - slideX * 2.4);
    expect(max.x).toBeCloseTo(0.5 - slideX * 1.4);
    expect(min.z).toBeCloseTo(-0.5 - slideZ * 2.4);
    expect(max.z).toBeCloseTo(0.5 - slideZ * 1.4);
  });

  it("keeps only faces the sun lights", () => {
    const box = { geometry: new BoxGeometry(1, 1, 1), matrix: new Matrix4() };
    // Of a box's 12 triangles, the sun sees the top and the +x and +z sides.
    expect(castShadows("test:lit", () => [box], SUN)!.index!.count / 3).toBe(6);
  });

  it("lays shadows on raised ground, counting height from it", () => {
    // Ground a step up everywhere: a box standing on it shadows as if on flat ground, lifted.
    const box = {
      geometry: new BoxGeometry(1, 1, 1),
      matrix: new Matrix4().makeTranslation(0, 0.5 + 0.15, 0),
    };
    const shadow = castShadows(
      "test:raised",
      () => [box],
      SUN,
      () => 0.15,
    )!;
    shadow.computeBoundingBox();
    const { min, max } = shadow.boundingBox!;
    expect(min.y).toBeCloseTo(0.15);
    expect(max.y).toBeCloseTo(0.15);
    expect(min.x).toBeCloseTo(-0.5 - slideX);
  });
});
