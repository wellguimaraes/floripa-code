import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createHoverIntent } from "./useHoverIntent";

describe("createHoverIntent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never fires while the pointer sweeps past", () => {
    const onIntent = vi.fn();
    const intent = createHoverIntent(onIntent);
    for (let step = 0; step < 20; step += 1) {
      expect(intent.track({ clientX: step * 10, clientY: 0 })).toBe(false);
      vi.advanceTimersByTime(50);
    }
    intent.reset();
    vi.advanceTimersByTime(1000);
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("fires with the latest point once the pointer settles, then tracks directly", () => {
    const onIntent = vi.fn();
    const intent = createHoverIntent(onIntent);
    intent.track({ clientX: 0, clientY: 0 });
    intent.track({ clientX: 40, clientY: 0 });
    vi.advanceTimersByTime(100);
    expect(onIntent).not.toHaveBeenCalled();

    intent.track({ clientX: 42, clientY: 3 });
    vi.advanceTimersByTime(100);
    expect(onIntent).toHaveBeenCalledExactlyOnceWith({ clientX: 42, clientY: 3 });
    expect(intent.track({ clientX: 200, clientY: 0 })).toBe(true);

    intent.reset();
    expect(intent.track({ clientX: 200, clientY: 0 })).toBe(false);
  });
});
