import { describe, expect, it } from "vite-plus/test";

import { islandWorlds } from "../definitions/island";
import { mainlandShoreline } from "./coast";

// Screen right and down for a ground point: the camera looks down the (1, 1) diagonal.
const screen = (x: number, z: number) => [(x - z) / Math.SQRT2, (x + z) / Math.SQRT2] as const;

describe("mainlandShoreline", () => {
  it.each(islandWorlds.map((definition, size) => [size, definition] as const))(
    "joins the island's lawn yet leaves its pier over water (size %i)",
    (_, definition) => {
      const shoreline = mainlandShoreline(definition);
      const sand = definition.terrain.find(
        (patch) => patch.kind === "sand" && patch.shape === "disc",
      );
      const lawn = definition.terrain.find(
        (patch) => patch.kind === "grass" && patch.shape === "disc",
      );
      if (sand?.shape !== "disc" || lawn?.shape !== "disc") throw new Error("no round island");
      const [, sandDown] = screen(...sand.center);

      // The coast's sand reaches into the lawn level with the island's middle.
      const [lawnRight, lawnDown] = screen(...lawn.center);
      expect(shoreline(lawnDown - sandDown)).toBeGreaterThan(lawnRight - lawn.radius);

      // Every corner of every pier plank stays right of the shore.
      const pier = definition.props.find((prop) => prop.arc !== undefined);
      expect(pier).toBeDefined();
      const { radius, width, left, right } = pier!.arc!;
      const angle = Math.atan2(
        pier!.position[2] - sand.center[1],
        pier!.position[0] - sand.center[0],
      );
      for (let step = 0; step <= 40; step += 1) {
        const at = angle - left / radius + (step / 40) * ((left + right) / radius);
        for (const distance of [radius, radius + width]) {
          const [pointRight, pointDown] = screen(
            sand.center[0] + distance * Math.cos(at),
            sand.center[1] + distance * Math.sin(at),
          );
          expect(shoreline(pointDown - sandDown)).toBeLessThan(pointRight);
        }
      }
    },
  );
});
