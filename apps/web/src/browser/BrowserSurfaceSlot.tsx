"use client";

import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface, type BrowserSurfaceCornerRadius } from "./browserSurfaceStore";
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
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const resolvedCornerRadius =
        presentation.cornerRadius ?? (clip ? cornerRadiusWithin(clip, rect) : 0);
      const presented = lease.present(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
        presentation.visible && rect.width > 0 && rect.height > 0,
        resolvedCornerRadius,
        presentation.zIndex,
      );
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          rect.width > 0 && rect.height > 0,
          resolvedCornerRadius,
          presentation.zIndex,
        );
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
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      stopObserving();
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
