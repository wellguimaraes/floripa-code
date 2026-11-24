import { useEffect, useRef, useState } from "react";

export interface HoverIntentPoint {
  clientX: number;
  clientY: number;
}

export interface HoverIntentOptions {
  /** Max pointer travel (Manhattan px) per `interval` that still counts as settled. */
  sensitivity?: number;
  /** How often (ms) pointer travel is sampled while waiting for intent. */
  interval?: number;
}

/**
 * Hover intent, after tristen/hoverintent: the pointer counts as hovering only once it
 * slows below `sensitivity` px of travel per `interval` ms, so sweeping across a target on
 * the way elsewhere never triggers it. Feed every pointer move to `track`; it returns true
 * once intent holds (act on that move directly). Until then, `onIntent` fires with the
 * latest point the moment the pointer settles. Call `reset` when the pointer leaves.
 */
export function createHoverIntent(
  onIntent: (point: HoverIntentPoint) => void,
  { sensitivity = 7, interval = 100 }: HoverIntentOptions = {},
) {
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let point: HoverIntentPoint = { clientX: 0, clientY: 0 };
  let sampled = point;

  const poll = () => {
    const travel =
      Math.abs(point.clientX - sampled.clientX) + Math.abs(point.clientY - sampled.clientY);
    if (travel < sensitivity) {
      timer = undefined;
      active = true;
      onIntent(point);
      return;
    }
    sampled = point;
    timer = setTimeout(poll, interval);
  };

  return {
    track(next: HoverIntentPoint): boolean {
      if (active) return true;
      point = { clientX: next.clientX, clientY: next.clientY };
      if (timer === undefined) {
        sampled = point;
        timer = setTimeout(poll, interval);
      }
      return false;
    },
    reset() {
      clearTimeout(timer);
      timer = undefined;
      active = false;
    },
  };
}

/** `createHoverIntent` bound to a component: latest `onIntent`, timer cleared on unmount. */
export function useHoverIntent(
  onIntent: (point: HoverIntentPoint) => void,
  options?: HoverIntentOptions,
) {
  const onIntentRef = useRef(onIntent);
  useEffect(() => {
    onIntentRef.current = onIntent;
  });
  const [intent] = useState(() =>
    createHoverIntent((point) => onIntentRef.current(point), options),
  );
  useEffect(() => intent.reset, [intent]);
  return intent;
}
