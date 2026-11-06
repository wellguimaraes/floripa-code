import { describe, expect, it } from "vite-plus/test";

import { CHAT_BUBBLE_SIZING, clampBubbleSize } from "./BubbleResizeFrame";

describe("clampBubbleSize", () => {
  const roomy = { width: 1920, height: 1200 };

  it("keeps the default size on a roomy window", () => {
    expect(clampBubbleSize(CHAT_BUBBLE_SIZING.defaultSize, roomy, CHAT_BUBBLE_SIZING)).toEqual(
      CHAT_BUBBLE_SIZING.defaultSize,
    );
  });

  it("stops a drag at the smallest and largest sizes", () => {
    expect(clampBubbleSize({ width: 10, height: 10 }, roomy, CHAT_BUBBLE_SIZING)).toEqual({
      width: 360,
      height: 120,
    });
    expect(clampBubbleSize({ width: 5000, height: 5000 }, roomy, CHAT_BUBBLE_SIZING)).toEqual({
      width: 960,
      height: 880,
    });
  });

  it("shrinks a size saved on a big screen to fit a small one", () => {
    expect(
      clampBubbleSize({ width: 900, height: 800 }, { width: 600, height: 700 }, CHAT_BUBBLE_SIZING),
    ).toEqual({
      width: 568,
      height: 380,
    });
  });
});
