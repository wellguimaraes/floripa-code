import * as Schema from "effect/Schema";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage";
import { useResizeDrag } from "./useResizeDrag";

const WidthSchema = Schema.Finite;

/**
 * Custom property the host element must size itself from. The drag handle sits
 * directly inside the host, and a drag writes this property on it each frame.
 */
export const RESIZABLE_WIDTH_PROPERTY = "--resizable-width";

export interface UseResizableWidthOptions {
  /** localStorage key the persisted width is stored under. */
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
  /**
   * Which edge of the host element carries the drag handle:
   *   - "left"  → panel grows leftward (right-anchored panels)
   *   - "right" → panel grows rightward (left-anchored panels)
   *   - "top" / "bottom" → the same vertically; `width` is then the host's height
   */
  readonly edge: "left" | "right" | "top" | "bottom";
  /** Starts something that resizes along with a drag from `width`, such as a panel inside the host. */
  readonly follow?: ((width: number) => ResizeFollower | null) | undefined;
}

/** Follows a drag live, before the width commits. */
export interface ResizeFollower {
  /** The host's bounds during this drag, in place of `minWidth` and `maxWidth`. */
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly resize?: (width: number) => void;
  readonly finish?: () => void;
  readonly cancel?: () => void;
}

export interface ResizableWidthHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => void;
}

/**
 * Width state for a side-anchored panel resized via a drag handle on the
 * specified edge. Width is read on mount or storage-key changes and persisted on
 * drag-end (not on every rAF tick — would otherwise be ~60 writes/sec).
 *
 * During a drag the hook writes `RESIZABLE_WIDTH_PROPERTY` on the handle's
 * parent, so the panel follows the cursor in the same frame without
 * re-rendering the owner. `width` state and localStorage commit once when the
 * user lifts the pointer or the drag is interrupted.
 */
export function useResizableWidth(options: UseResizableWidthOptions): {
  readonly width: number;
  /** The width the user chose, before `maxWidth` clamps it. */
  readonly requestedWidth: number;
  readonly handlers: ResizableWidthHandlers;
  /** Commits and remembers a width set from outside a drag. */
  readonly setWidth: (width: number) => void;
} {
  const { storageKey, defaultWidth, minWidth, maxWidth, edge, follow } = options;

  const clamp = useCallback(
    (value: number, floor = minWidth, ceiling = maxWidth): number => {
      if (!Number.isFinite(value)) return defaultWidth;
      return Math.max(floor, Math.min(ceiling, value));
    },
    [defaultWidth, maxWidth, minWidth],
  );

  // No cross-tab subscription: panel width is per-window state.
  const readWidth = () => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const stored = getLocalStorageItem(storageKey, WidthSchema);
      return clamp(stored ?? defaultWidth);
    } catch (error) {
      console.error("Could not read persisted panel width.", error);
      return defaultWidth;
    }
  };
  const [widthState, setWidthState] = useState(() => ({ storageKey, width: readWidth() }));
  // Panels stay mounted across threads; restore the destination width before paint.
  if (widthState.storageKey !== storageKey) {
    setWidthState({ storageKey, width: readWidth() });
  }

  const clampedWidth = clamp(widthState.width);
  const latestOptions = useRef({ clamp, width: clampedWidth });
  useLayoutEffect(() => {
    latestOptions.current = { clamp, width: clampedWidth };
  }, [clamp, clampedWidth]);

  const setWidth = useCallback(
    (width: number) => {
      setWidthState({ storageKey, width });
      try {
        setLocalStorageItem(storageKey, width, WidthSchema);
      } catch (error) {
        console.error("Could not persist panel width.", error);
      }
    },
    [storageKey],
  );

  const { refresh, ...handlers } = useResizeDrag<HTMLElement>((event) => {
    const host = event.currentTarget.parentElement;
    // A collapsible host animates width; live drag writes must not. The host
    // renders its own transition-duration, so override a property it leaves alone.
    host?.style.setProperty("transition-property", "none");
    const follower = follow?.(clampedWidth) ?? null;
    return {
      width: clampedWidth,
      edge,
      resize(value) {
        const nextWidth = latestOptions.current.clamp(
          value,
          follower?.minWidth,
          follower?.maxWidth,
        );
        host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${nextWidth}px`);
        follower?.resize?.(nextWidth);
        return nextWidth;
      },
      // Commit once at drag-end to avoid 60Hz localStorage writes.
      finish(finalWidth) {
        setWidth(finalWidth);
        follower?.finish?.();
      },
      cleanup(committed) {
        host?.style.removeProperty("transition-property");
        // React skips the write when the rendered width did not change.
        if (!committed) {
          host?.style.setProperty(RESIZABLE_WIDTH_PROPERTY, `${latestOptions.current.width}px`);
          follower?.cancel?.();
        }
      },
    };
  }, storageKey);

  // Bounds can change mid-drag (sidebar opens, window narrows) and the render
  // rewrites the committed width, so re-apply the live pointer position.
  useLayoutEffect(refresh, [clamp, clampedWidth, refresh]);

  return { width: clampedWidth, requestedWidth: widthState.width, handlers, setWidth };
}
