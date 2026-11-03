import { describe, expect, it } from "vite-plus/test";

import { clampBubbleSize, DEFAULT_BUBBLE_SIZE } from "./BubbleResizeFrame";

describe("clampBubbleSize", () => {
  const roomy = { width: 1920, height: 1200 };

  it("keeps the default size on a roomy window", () => {
    expect(clampBubbleSize(DEFAULT_BUBBLE_SIZE, roomy)).toEqual(DEFAULT_BUBBLE_SIZE);
  });

  it("stops a drag at the smallest and largest sizes", () => {
    expect(clampBubbleSize({ width: 10, height: 10 }, roomy)).toEqual({ width: 360, height: 120 });
    expect(clampBubbleSize({ width: 5000, height: 5000 }, roomy)).toEqual({
      width: 960,
      height: 880,
    });
  });

  it("shrinks a size saved on a big screen to fit a small one", () => {
    expect(clampBubbleSize({ width: 900, height: 800 }, { width: 600, height: 700 })).toEqual({
      width: 568,
      height: 380,
    });
  });
});
