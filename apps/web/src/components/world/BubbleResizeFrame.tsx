import * as Schema from "effect/Schema";
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";

const BubbleSize = Schema.Struct({ width: Schema.Number, height: Schema.Number });
type BubbleSize = typeof BubbleSize.Type;

const STORAGE_KEY = "floripacode:world-bubble-size:v1";
/** The bubble's width and its conversation's height before anyone drags it. */
export const DEFAULT_BUBBLE_SIZE: BubbleSize = { width: 432, height: 320 };
const MIN_WIDTH = 360;
const MAX_WIDTH = 960;
const MIN_HEIGHT = 120;
/** Room the header and composer keep around the conversation when it is tallest. */
const CHROME_HEIGHT = 320;

/**
 * Keeps a dragged size inside what the window can show. `window` is the viewport size: a size
 * saved on a big screen still fits a small one.
 */
export function clampBubbleSize(
  size: BubbleSize,
  window: { width: number; height: number },
): BubbleSize {
  const clamp = (value: number, low: number, high: number) =>
    Math.round(Math.min(Math.max(value, low), Math.max(low, high)));
  return {
    width: clamp(size.width, MIN_WIDTH, Math.min(MAX_WIDTH, window.width - 32)),
    height: clamp(size.height, MIN_HEIGHT, window.height - CHROME_HEIGHT),
  };
}

/** Which way each grip moves the edges: -1 or 1 grows with the pointer, 0 leaves that axis. */
const GRIPS = [
  { x: -1, y: 0, className: "inset-y-3 -left-1 w-2 cursor-ew-resize" },
  { x: 1, y: 0, className: "inset-y-3 -right-1 w-2 cursor-ew-resize" },
  { x: 0, y: -1, className: "inset-x-3 -top-1 h-2 cursor-ns-resize" },
  { x: -1, y: -1, className: "-top-1 -left-1 size-3 cursor-nwse-resize" },
  { x: 1, y: -1, className: "-top-1 -right-1 size-3 cursor-nesw-resize" },
  { x: 0, y: 1, className: "inset-x-3 -bottom-1 h-2 cursor-ns-resize" },
  { x: -1, y: 1, className: "-bottom-1 -left-1 size-3 cursor-nesw-resize" },
  { x: 1, y: 1, className: "-right-1 -bottom-1 size-3 cursor-nwse-resize" },
] as const;

/**
 * Set on the frame once the user starts resizing. The world's placement leaves a bubble that
 * carries it where it is, so a resize never slides or re-clamps the bubble or pans the map;
 * placement resumes when the bubble opens again.
 */
export const BUBBLE_RESIZED_ATTRIBUTE = "data-bubble-resized";

/**
 * Set on the frame once the user drags it by its handle. The world's placement then stops moving
 * the bubble at all, so it stays where it was dropped while the map pans or its character walks;
 * placement resumes when the bubble opens again.
 */
export const BUBBLE_MOVED_ATTRIBUTE = "data-bubble-moved";

/** Marks the part of a bubble that drags it, its header. Controls inside it still click. */
export const BUBBLE_DRAG_HANDLE_ATTRIBUTE = "data-bubble-drag-handle";

const INTERACTIVE = "button, a, input, textarea, select, [role=button], [contenteditable=true]";
/** How close a dragged bubble may come to the window's edges. */
const EDGE_PX = 8;

/**
 * A chat bubble the user can resize from any edge or corner, remembered in this browser. The
 * dragged edge follows the pointer and the opposite one stays put: the frame offsets itself
 * against the centring and bottom anchoring its parent gives it. The children read
 * `--bubble-width` and `--bubble-exchange-height`, the conversation's height. Dragging writes
 * straight to the frame, so the bubble does not re-render per move; the size is saved on
 * release. Double-clicking a grip restores the default size and position. Dragging the
 * element marked with `BUBBLE_DRAG_HANDLE_ATTRIBUTE` moves the whole frame, kept inside the
 * window; the position is not remembered, so the bubble opens over its character again.
 */
export function BubbleResizeFrame(props: { readonly children: ReactNode }) {
  const [stored, setStored] = useLocalStorage(STORAGE_KEY, DEFAULT_BUBBLE_SIZE, BubbleSize);
  const size = clampBubbleSize(stored, { width: window.innerWidth, height: window.innerHeight });
  const frame = useRef<HTMLDivElement>(null);
  // How far resizing has moved the frame from where its parent puts it; kept until it closes.
  const offset = useRef({ x: 0, y: 0 });
  const drag = useRef<{
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly grip: (typeof GRIPS)[number];
    readonly start: BubbleSize;
    readonly startOffset: { readonly x: number; readonly y: number };
    current: BubbleSize;
  } | null>(null);
  const move = useRef<{
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
    readonly startOffset: { readonly x: number; readonly y: number };
    readonly rect: DOMRect;
  } | null>(null);

  const apply = (next: BubbleSize) => {
    const element = frame.current;
    if (element === null) return;
    element.style.setProperty("--bubble-width", `${next.width}px`);
    element.style.setProperty("--bubble-exchange-height", `${next.height}px`);
    element.style.translate = `${offset.current.x}px ${offset.current.y}px`;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, grip: (typeof GRIPS)[number]) => {
    if (event.button !== 0 || frame.current === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    frame.current.setAttribute(BUBBLE_RESIZED_ATTRIBUTE, "");
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      grip,
      start: size,
      startOffset: offset.current,
      current: size,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const { grip, start } = active;
    active.current = clampBubbleSize(
      {
        width: start.width + grip.x * (event.clientX - active.x),
        height: start.height + grip.y * (event.clientY - active.y),
      },
      { width: window.innerWidth, height: window.innerHeight },
    );
    // The parent centres the frame and hangs it from its bottom: half the width it gains goes
    // to each side, and all the height it gains goes on top. Shift it back so only the dragged
    // edges move.
    const grownWidth = active.current.width - start.width;
    const grownHeight = active.current.height - start.height;
    offset.current = {
      x: active.startOffset.x + (grip.x * grownWidth) / 2,
      y: active.startOffset.y + (grip.y === 1 ? grownHeight : 0),
    };
    apply(active.current);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    drag.current = null;
    if (active.current !== active.start) setStored(active.current);
  };

  const onMoveStart = (event: PointerEvent<HTMLDivElement>) => {
    const element = frame.current;
    if (event.button !== 0 || element === null || !(event.target instanceof Element)) return;
    const handle = event.target.closest(`[${BUBBLE_DRAG_HANDLE_ATTRIBUTE}]`);
    if (handle === null || !element.contains(handle)) return;
    if (event.target.closest(INTERACTIVE) !== null) return;
    event.preventDefault();
    event.stopPropagation();
    element.setPointerCapture(event.pointerId);
    element.setAttribute(BUBBLE_MOVED_ATTRIBUTE, "");
    move.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startOffset: offset.current,
      rect: element.getBoundingClientRect(),
    };
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = move.current;
    if (active === null || active.pointerId !== event.pointerId) return;
    const { rect } = active;
    // The far edge wins for a bubble larger than the window, keeping its header in reach.
    const clamp = (value: number, low: number, high: number) =>
      Math.max(Math.min(value, high), low);
    const dx = clamp(
      event.clientX - active.x,
      EDGE_PX - rect.left,
      window.innerWidth - EDGE_PX - rect.right,
    );
    const dy = clamp(
      event.clientY - active.y,
      EDGE_PX - rect.top,
      window.innerHeight - EDGE_PX - rect.bottom,
    );
    offset.current = { x: active.startOffset.x + dx, y: active.startOffset.y + dy };
    apply(size);
  };

  const onMoveEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (move.current?.pointerId === event.pointerId) move.current = null;
  };

  return (
    <div
      ref={frame}
      className="pointer-events-auto relative"
      onPointerDown={onMoveStart}
      onPointerMove={onMove}
      onPointerUp={onMoveEnd}
      onPointerCancel={onMoveEnd}
      style={
        {
          "--bubble-width": `${size.width}px`,
          "--bubble-exchange-height": `${size.height}px`,
        } as CSSProperties
      }
    >
      {props.children}
      {GRIPS.map((grip) => (
        <div
          key={grip.className}
          aria-hidden
          // Above the bubble's own layers, whose highest (the text field) stacks at z-40.
          className={cn("absolute z-50 touch-none", grip.className)}
          onPointerDown={(event) => onPointerDown(event, grip)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onDoubleClick={() => {
            offset.current = { x: 0, y: 0 };
            apply(DEFAULT_BUBBLE_SIZE);
            setStored(DEFAULT_BUBBLE_SIZE);
          }}
        />
      ))}
    </div>
  );
}
