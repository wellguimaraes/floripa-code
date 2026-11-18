import { describe, expect, it } from "vite-plus/test";

import { placeBeside, placeOn, roomiestSide } from "./bubbleSide";

const area = { left: 0, top: 0, right: 1000, bottom: 800 };
const size = { width: 300, height: 200 };
const gap = 10;

describe("placeBeside", () => {
  it("prefers above when it leaves the most room, centred on what it avoids", () => {
    const avoid = { left: 480, top: 400, right: 520, bottom: 480 };
    expect(placeBeside({ avoid, size, area, gap, previous: null })).toEqual({
      side: "above",
      left: 350,
      top: 190,
    });
  });

  it("prefers the side with the most room", () => {
    const avoid = { left: 100, top: 300, right: 140, bottom: 380 };
    expect(placeBeside({ avoid, size, area, gap, previous: null })?.side).toBe("right");
  });

  it("goes to the side when there is no room above", () => {
    const avoid = { left: 200, top: 50, right: 400, bottom: 700 };
    expect(placeBeside({ avoid, size, area, gap, previous: null })).toEqual({
      side: "right",
      left: 410,
      top: 275,
    });
  });

  it("goes left when the path runs to the right edge", () => {
    const avoid = { left: 600, top: 50, right: 990, bottom: 700 };
    expect(placeBeside({ avoid, size, area, gap, previous: null })?.side).toBe("left");
  });

  it("goes below only when nothing else fits", () => {
    const avoid = { left: 0, top: 20, right: 1000, bottom: 300 };
    expect(placeBeside({ avoid, size, area, gap, previous: null })).toEqual({
      side: "below",
      left: 350,
      top: 310,
    });
  });

  it("keeps the previous side while it still fits", () => {
    const avoid = { left: 480, top: 400, right: 520, bottom: 480 };
    expect(placeBeside({ avoid, size, area, gap, previous: "left" })?.side).toBe("left");
  });

  it("slides along its side to stay inside the area", () => {
    const avoid = { left: 0, top: 400, right: 40, bottom: 480 };
    expect(placeBeside({ avoid, size, area, gap, previous: "above" })).toMatchObject({
      side: "above",
      left: 0,
    });
  });

  it("names the side missing the least room when none fits, and stays inside the area on it", () => {
    const avoid = { left: 0, top: 100, right: 1000, bottom: 800 };
    expect(roomiestSide({ avoid, size, area, gap })).toBe("above");
    expect(placeOn("above", { avoid, size, area, gap })).toEqual({ left: 350, top: 0 });
  });

  it("gives up when no side has room", () => {
    const avoid = { left: 0, top: 0, right: 1000, bottom: 800 };
    expect(placeBeside({ avoid, size, area, gap, previous: null })).toBeNull();
  });
});
