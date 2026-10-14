import { describe, expect, it } from "vite-plus/test";

import type { WorldDefinition } from "../definition/types";
import { groundHeight, TERRAIN_TOP } from "./terrain";

describe("groundHeight", () => {
  const definition = {
    terrain: [
      { shape: "disc", kind: "sand", center: [0, 0], radius: 9.5 },
      { shape: "disc", kind: "grass", center: [-2, 0], radius: 7.2 },
    ],
  } as unknown as WorldDefinition;
  const ground = groundHeight(definition);

  it("stands on the lawn's top inside it", () => {
    expect(ground(-2, 0)).toBe(TERRAIN_TOP.grass);
    expect(ground(-6, 3)).toBe(TERRAIN_TOP.grass);
  });

  it("is level with the sand off the lawn", () => {
    expect(ground(7.5, 0)).toBe(0);
    expect(ground(30, 30)).toBe(0);
  });

  it("slopes down the lawn's bank", () => {
    const heights = [6.6, 6.8, 7, 7.15].map((along) => ground(-2 + along, 0));
    for (let index = 1; index < heights.length; index += 1) {
      expect(heights[index]!).toBeLessThanOrEqual(heights[index - 1]!);
    }
    expect(heights[0]!).toBeGreaterThan(0);
  });
});
