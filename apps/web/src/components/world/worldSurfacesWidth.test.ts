import { describe, expect, it } from "vite-plus/test";

import { scaleSurfacesWidth } from "./worldSurfacesWidth";

const minimums = { chat: 400, surfaces: 360 };
const start = { frame: 1200, surfaces: 600 };

describe("scaleSurfacesWidth", () => {
  it("scales both sides together", () => {
    expect(scaleSurfacesWidth(1000, start, minimums)).toBe(500);
    expect(scaleSurfacesWidth(1600, start, minimums)).toBe(800);
  });

  it("shrinks the surfaces once the chat reaches its minimum", () => {
    expect(scaleSurfacesWidth(800, start, minimums)).toBe(400);
    expect(scaleSurfacesWidth(760, start, minimums)).toBe(360);
  });

  it("shrinks the chat once the surfaces reach theirs", () => {
    const narrowSurfaces = { frame: 1200, surfaces: 400 };
    expect(scaleSurfacesWidth(1000, narrowSurfaces, minimums)).toBe(360);
  });
});
