import { type PointerEvent, useCallback, useEffect, useLayoutEffect, useRef } from "react";

interface ResizeSession {
  width: number;
  /** The edge the handle sits on. "top" and "bottom" drag vertically, so `width` is a height. */
  edge: "left" | "right" | "top" | "bottom";
  resize: (width: number) => number;
  finish: (width: number, moved: boolean) => void;
  /** Runs on every end; `committed` is false when the drag was abandoned without `finish`. */
  cleanup?: (committed: boolean) => void;
}

const isVertical = (session: ResizeSession) => session.edge === "top" || session.edge === "bottom";

const pointerPosition = (session: ResizeSession, event: PointerEvent) =>
  isVertical(session) ? event.clientY : event.clientX;

/** Shared pointer lifecycle for side panels, including interrupted and sub-frame drags. */
export function useResizeDrag<T extends HTMLElement>(
  start: (event: PointerEvent<T>) => ResizeSession | null,
  resetKey?: string,
) {
  const drag = useRef<{
    session: ResizeSession;
    target: T;
    pointerId: number;
    startPosition: number;
    pendingPosition: number;
    width: number;
    moved: boolean;
    frame: number | null;
  } | null>(null);

  const flush = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    const { edge } = active.session;
    const delta =
      (active.pendingPosition - active.startPosition) *
      (edge === "left" || edge === "top" ? -1 : 1);
    active.moved ||= Math.abs(delta) > 2;
    active.width = active.session.resize(active.session.width + delta);
  }, []);

  const finish = useCallback(
    (commit = true) => {
      const active = drag.current;
      if (!active) return;
      if (active.frame !== null) cancelAnimationFrame(active.frame);
      if (commit) flush();
      // Release can synchronously dispatch lostpointercapture.
      drag.current = null;
      try {
        if (active.target.hasPointerCapture(active.pointerId)) {
          active.target.releasePointerCapture(active.pointerId);
        }
      } catch {
        // Capture may already have been released by the browser.
      }
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      active.session.cleanup?.(commit);
      if (commit) active.session.finish(active.width, active.moved);
    },
    [flush],
  );

  const previousResetKey = useRef(resetKey);
  useLayoutEffect(() => {
    if (previousResetKey.current !== resetKey) {
      finish(false);
      previousResetKey.current = resetKey;
    }
  }, [finish, resetKey]);

  useEffect(() => {
    const onBlur = () => finish();
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      finish(false);
    };
  }, [finish]);

  const end = (event: PointerEvent<T>, usePosition: boolean) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (usePosition) active.pendingPosition = pointerPosition(active.session, event);
    finish();
  };

  return {
    /** Re-applies the pointer position to an active drag, e.g. after its bounds change. */
    refresh: flush,
    onPointerDown(event: PointerEvent<T>) {
      if (event.button !== 0) return;
      // A drag still on record missed its end (its handle unmounted mid-drag, or
      // the release landed where the page never saw it). Drop it, or every later
      // drag is ignored until the window blurs.
      finish(false);
      const session = start(event);
      if (!session) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        session.cleanup?.(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      drag.current = {
        session,
        target: event.currentTarget,
        pointerId: event.pointerId,
        startPosition: pointerPosition(session, event),
        pendingPosition: pointerPosition(session, event),
        width: session.width,
        moved: false,
        frame: null,
      };
      document.body.style.cursor = isVertical(session) ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    onPointerMove(event: PointerEvent<T>) {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      active.pendingPosition = pointerPosition(active.session, event);
      active.moved ||= Math.abs(active.pendingPosition - active.startPosition) > 2;
      if (active.frame !== null) return;
      active.frame = requestAnimationFrame(() => {
        active.frame = null;
        flush();
      });
    },
    onPointerUp: (event: PointerEvent<T>) => end(event, true),
    onPointerCancel: (event: PointerEvent<T>) => end(event, false),
    onLostPointerCapture: (event: PointerEvent<T>) => end(event, false),
  };
}
