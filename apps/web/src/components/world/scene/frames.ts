const pending = new WeakSet<() => void>();

/**
 * Asks for one more frame in `1000 / fps` ms. Callers on the same canvas share
 * one timer, so twenty walkers together still draw at `fps`, not twenty times
 * that (up to the display's rate).
 */
export function drawSoon(invalidate: () => void, fps: number): void {
  if (pending.has(invalidate)) return;
  pending.add(invalidate);
  setTimeout(() => {
    pending.delete(invalidate);
    invalidate();
  }, 1000 / fps);
}
