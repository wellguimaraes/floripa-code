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

/**
 * Runs `run` once the browser has painted the current frame: the animation
 * frame lands just before the paint, the task queued from it just after.
 * Returns a cancel.
 */
export function afterPaint(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(run);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

/**
 * Runs `run` when the main thread has nothing else to do, or after `timeoutMs`
 * at the latest. Safari has no idle callbacks, so there it runs after the
 * next paint. Returns a cancel.
 */
export function whenIdle(run: () => void, timeoutMs: number): () => void {
  if (typeof requestIdleCallback !== "function") return afterPaint(run);
  const handle = requestIdleCallback(run, { timeout: timeoutMs });
  return () => cancelIdleCallback(handle);
}
