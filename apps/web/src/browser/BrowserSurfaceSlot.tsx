"use client";

import { useLayoutEffect, useRef } from "react";

import {
  acquireBrowserSurface,
  type BrowserSurfaceClipInset,
  type BrowserSurfaceCornerRadius,
} from "./browserSurfaceStore";
import { observeResize } from "../lib/observeResize";

const CORNER_TOLERANCE_PX = 1;

/** Nearest ancestor that clips its content to rounded corners, such as the world's frame. */
function findRoundedClipAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflow === "visible") continue;
    if (
      Number.parseFloat(style.borderTopLeftRadius) > 0 ||
      Number.parseFloat(style.borderTopRightRadius) > 0 ||
      Number.parseFloat(style.borderBottomRightRadius) > 0 ||
      Number.parseFloat(style.borderBottomLeftRadius) > 0
    ) {
      return node;
    }
  }
  return null;
}

/** Ancestors that clip their overflow, such as a closing panel's frame. */
function findClipAncestors(element: HTMLElement): HTMLElement[] {
  const clips: HTMLElement[] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== "visible" || style.overflowY !== "visible") clips.push(node);
  }
  return clips;
}

/**
 * What the clipping ancestors cut off the slot. A closing panel shrinks around content that keeps
 * its width, so the slot keeps its rect while less of it shows; the overlay webview must follow.
 */
function clipInsetWithin(
  clips: ReadonlyArray<HTMLElement>,
  rect: DOMRect,
): BrowserSurfaceClipInset | null {
  let { top, right, bottom, left } = rect;
  for (const clip of clips) {
    const bounds = clip.getBoundingClientRect();
    top = Math.max(top, bounds.top);
    right = Math.min(right, bounds.right);
    bottom = Math.min(bottom, bounds.bottom);
    left = Math.max(left, bounds.left);
  }
  const inset = {
    top: Math.max(0, Math.round(top - rect.top)),
    right: Math.max(0, Math.round(rect.right - right)),
    bottom: Math.max(0, Math.round(rect.bottom - bottom)),
    left: Math.max(0, Math.round(left - rect.left)),
  };
  return inset.top === 0 && inset.right === 0 && inset.bottom === 0 && inset.left === 0
    ? null
    : inset;
}

/**
 * The overlay webview lives outside the slot's DOM, so the clipping ancestor's rounded corners
 * do not cut it. Round the slot corners that sit on that ancestor's corners instead.
 */
function cornerRadiusWithin(clip: HTMLElement, rect: DOMRect): BrowserSurfaceCornerRadius {
  const frame = clip.getBoundingClientRect();
  const style = getComputedStyle(clip);
  const near = (a: number, b: number) => Math.abs(a - b) <= CORNER_TOLERANCE_PX;
  const top = near(rect.top, frame.top);
  const bottom = near(rect.bottom, frame.bottom);
  const left = near(rect.left, frame.left);
  const right = near(rect.right, frame.right);
  const corners = [
    top && left ? style.borderTopLeftRadius : "0px",
    top && right ? style.borderTopRightRadius : "0px",
    bottom && right ? style.borderBottomRightRadius : "0px",
    bottom && left ? style.borderBottomLeftRadius : "0px",
  ];
  return corners.every((corner) => Number.parseFloat(corner) === 0) ? 0 : corners.join(" ");
}

const GEOMETRY_TRANSITION_PROPERTY =
  /^(?:translate|transform|scale|inset|top|right|bottom|left|width|height|margin|padding)/;

/**
 * Re-measures every frame while an ancestor runs a geometry transition. A slide such as the
 * world's chat frame entering with `translate` moves the slot without resizing anything, so
 * no ResizeObserver fires and the overlay webview would keep the mid-slide position.
 */
function followAncestorTransitions(element: HTMLElement, update: () => void): () => void {
  const running = new Map<Element, Set<string>>();
  let frame = 0;
  const tick = () => {
    frame = 0;
    for (const target of running.keys()) {
      if (!target.isConnected) running.delete(target);
    }
    update();
    if (running.size > 0) frame = window.requestAnimationFrame(tick);
  };
  const isAncestorGeometry = (
    event: TransitionEvent,
  ): event is TransitionEvent & {
    target: Element;
  } =>
    event.target instanceof Element &&
    event.target !== element &&
    event.target.contains(element) &&
    GEOMETRY_TRANSITION_PROPERTY.test(event.propertyName);
  const onRun = (event: TransitionEvent) => {
    if (!isAncestorGeometry(event)) return;
    const properties = running.get(event.target) ?? new Set<string>();
    properties.add(event.propertyName);
    running.set(event.target, properties);
    if (frame === 0) frame = window.requestAnimationFrame(tick);
  };
  const onStop = (event: TransitionEvent) => {
    if (!isAncestorGeometry(event)) return;
    const properties = running.get(event.target);
    properties?.delete(event.propertyName);
    if (properties?.size === 0) running.delete(event.target);
    // The final position lands after the last running frame.
    update();
  };
  document.addEventListener("transitionrun", onRun, true);
  document.addEventListener("transitionend", onStop, true);
  document.addEventListener("transitioncancel", onStop, true);
  return () => {
    document.removeEventListener("transitionrun", onRun, true);
    document.removeEventListener("transitionend", onStop, true);
    document.removeEventListener("transitioncancel", onStop, true);
    if (frame !== 0) window.cancelAnimationFrame(frame);
    running.clear();
  };
}

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  /** Defaults to the corners the slot shares with its nearest rounded, clipping ancestor. */
  readonly cornerRadius?: number;
  readonly zIndex?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius,
    zIndex = 30,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, cornerRadius, zIndex });
  const updateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    const clip = findRoundedClipAncestor(element);
    const clips = findClipAncestors(element);
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const resolvedCornerRadius =
        presentation.cornerRadius ?? (clip ? cornerRadiusWithin(clip, rect) : 0);
      const clipInset = clipInsetWithin(clips, rect);
      const shows =
        rect.width > 0 &&
        rect.height > 0 &&
        (clipInset === null ||
          (clipInset.left + clipInset.right < rect.width &&
            clipInset.top + clipInset.bottom < rect.height));
      const present = () =>
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          presentation.visible && shows,
          resolvedCornerRadius,
          presentation.zIndex,
          clipInset,
        );
      // Present first: a hidden slot must still report itself hidden.
      const presented = present();
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        present();
      }
    };
    updateRef.current = update;
    update();
    const observed: Element[] = [element];
    // Inline panels animate their outer width while keeping the content at
    // full width. The slot moves without resizing, so measure on shell resizes too.
    const panel = element.closest('[data-preview-panel-mode="inline"]');
    if (panel) observed.push(panel);
    // A sidebar opening or closing shifts the whole column, so a slot that keeps
    // its size and its offset inside the column (the mini player on the left)
    // still moves on screen. The gap element carries the sidebar's width.
    observed.push(...document.querySelectorAll('[data-slot="sidebar-gap"]'));
    const stopObserving = observeResize(observed, update);
    const stopFollowingTransitions = followAncestorTransitions(element, update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      stopObserving();
      stopFollowingTransitions();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius, zIndex };
    updateRef.current?.();
  }, [cornerRadius, layoutVersion, visible, zIndex]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}
