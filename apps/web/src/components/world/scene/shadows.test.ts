import { BoxGeometry, Matrix4 } from "three";
import { describe, expect, it } from "vite-plus/test";

import { castShadows } from "./shadows";

describe("castShadows", () => {
  it("lays a raised box's shadow on the ground, away from the sun", () => {
    // A unit box floating with its bottom 1.4 up: the sun at (6, 14, 9) pushes
    // its shadow 6/14 along -x and 9/14 along -z per unit of height.
    const box = {
      geometry: new BoxGeometry(1, 1, 1),
      matrix: new Matrix4().makeTranslation(0, 1.9, 0),
    };
    const shadow = castShadows("test:box", () => [box])!;
    shadow.computeBoundingBox();
    const { min, max } = shadow.boundingBox!;
    expect(min.y).toBe(0);
    expect(max.y).toBe(0);
    expect(min.x).toBeCloseTo(-0.5 - (6 / 14) * 2.4);
    expect(max.x).toBeCloseTo(0.5 - (6 / 14) * 1.4);
    expect(min.z).toBeCloseTo(-0.5 - (9 / 14) * 2.4);
    expect(max.z).toBeCloseTo(0.5 - (9 / 14) * 1.4);
  });

  it("keeps only faces the sun lights", () => {
    const box = { geometry: new BoxGeometry(1, 1, 1), matrix: new Matrix4() };
    // Of a box's 12 triangles, the sun sees the top and the +x and +z sides.
    expect(castShadows("test:lit", () => [box])!.index!.count / 3).toBe(6);
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
      () => 0.15,
    )!;
    shadow.computeBoundingBox();
    const { min, max } = shadow.boundingBox!;
    expect(min.y).toBeCloseTo(0.15);
    expect(max.y).toBeCloseTo(0.15);
    expect(min.x).toBeCloseTo(-0.5 - 6 / 14);
  });
});
