import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { ScrollArea } from "../ui/scroll-area";
import { Popover, PopoverPopup, PopoverCreateHandle } from "../ui/popover";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { useChatCanvas } from "./ChatCanvasContext";
import { resolveThreadDetailsCardDensity } from "./threadDetailsCardLayout";
import { observeResize } from "../../lib/observeResize";

/**
 * The thread's details float from their toggle as a popover; they never take a spot in the
 * chat. Content folds only when it cannot fit the window.
 */
export function ThreadDetailsCard({
  threadRef,
  anchor,
  handle,
  onPresentationChange,
  children,
}: {
  threadRef: ScopedThreadRef;
  anchor: RefObject<Element | null>;
  handle: ReturnType<typeof PopoverCreateHandle>;
  onPresentationChange: (presentation: ThreadPanelPresentation) => void;
  children: (density: "full" | "compact" | "essential") => ReactNode;
}) {
  const canvas = useChatCanvas();
  const popoverOpen = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, "popover"),
  );
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
  const measurementKey = `${threadRef.environmentId}:${threadRef.threadId}`;
  const [measurements, setMeasurements] = useState({
    key: measurementKey,
    heights: { full: 0, compact: 0 },
  });
  const contentHeights =
    measurements.key === measurementKey ? measurements.heights : { full: 0, compact: 0 };
  const height = Math.max(0, (canvas?.container.height ?? 0) - 52);
  const density = resolveThreadDetailsCardDensity(height, contentHeights);
  useLayoutEffect(() => {
    onPresentationChange("popover");
  }, [onPresentationChange]);
  useLayoutEffect(() => {
    const element = contentElement;
    if (!element || density === "essential") return;
    // Measure the single content tree before the scroll viewport clips it. Retain each
    // observed height so increasing available space restores the detail it can hold.
    const measure = () => {
      const frame = element.closest<HTMLElement>("[data-thread-details-card]");
      const fittingHeight =
        element.offsetHeight + (frame ? frame.offsetHeight - frame.clientHeight : 0);
      setMeasurements((current) => {
        const heights = current.key === measurementKey ? current.heights : { full: 0, compact: 0 };
        return current.key === measurementKey && heights[density] === fittingHeight
          ? current
          : { key: measurementKey, heights: { ...heights, [density]: fittingHeight } };
      });
    };
    measure();
    return observeResize(element, measure);
  }, [contentElement, density, measurementKey]);
  return (
    <Popover
      handle={handle}
      open={popoverOpen}
      onOpenChange={(open) =>
        useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", open)
      }
    >
      <PopoverPopup
        anchor={anchor}
        align="end"
        alignOffset={0}
        collisionAvoidance={{ side: "shift", align: "shift", fallbackAxisSide: "none" }}
        side="bottom"
        sideOffset={0}
        variant="panel"
        padding="none"
      >
        <div data-density={density} data-thread-details-panel="popover">
          <div
            className="dropdown-glass isolate contain-paint grid max-h-[min(calc(100dvh-6.5rem),calc(var(--available-height,100dvh)-1rem))] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-3xl"
            data-thread-details-card
          >
            <ScrollArea scrollFade className="min-h-0">
              <div ref={setContentElement}>{children(density)}</div>
            </ScrollArea>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
