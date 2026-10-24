import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isElectron } from "~/env";
import {
  getPreviewPanelMaxWidth,
  type PreviewPanelInlineSize,
  usePreviewPanelInlineSize,
} from "~/hooks/usePreviewPanelInlineSize";
import { RESIZABLE_WIDTH_PROPERTY } from "~/hooks/useResizableWidth";

export { getPreviewPanelMaxWidth };
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "./RightPanelResizeHandle";

export type PreviewPanelMode = "inline" | "sheet" | "sidebar" | "embedded";

/**
 * Shell for the preview panel. In inline mode the panel is user-resizable
 * via a drag handle on the left edge; width persists per browser. In
 * sheet/sidebar modes the parent owns the size.
 */
interface PreviewPanelShellProps {
  mode: PreviewPanelMode;
  maximized?: boolean;
  inlineSize?: PreviewPanelInlineSize;
  open?: boolean;
  /**
   * Overrides the localStorage key used to persist the panel width. Callers
   * embedding this shell for a different surface (e.g. the pull requests
   * page) should pass their own key so resizing one panel doesn't clobber
   * the other's remembered width.
   */
  widthStorageKey?: string;
  /** Overrides the initial width (px) before the user has resized the panel. */
  defaultWidth?: number;
  /** CSS width a collapsible panel opens from and closes to, e.g. a rail that stays visible. */
  closedWidth?: string;
  /** Maximized, keep the panel's own width because its container shrinks around it instead. */
  keepWidthWhenMaximized?: boolean;
  children: ReactNode;
}

export function PreviewPanelShell(props: PreviewPanelShellProps) {
  if (props.inlineSize) {
    return <PreviewPanelShellFrame {...props} inlineSize={props.inlineSize} />;
  }

  return <ResizablePreviewPanelShell {...props} />;
}

function ResizablePreviewPanelShell(props: PreviewPanelShellProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const inlineSize = usePreviewPanelInlineSize(hostRef, {
    enabled: props.mode === "inline" && !props.maximized,
    widthStorageKey: props.widthStorageKey,
    defaultWidth: props.defaultWidth,
  });
  return <PreviewPanelShellFrame {...props} inlineSize={inlineSize} hostRef={hostRef} />;
}

function PreviewPanelShellFrame(
  props: PreviewPanelShellProps & {
    inlineSize: PreviewPanelInlineSize;
    hostRef?: RefObject<HTMLDivElement | null>;
  },
) {
  const useDragRegion = isElectron && props.mode !== "sheet" && props.mode !== "embedded";
  const isInline = props.mode === "inline";
  const collapsible = isInline && props.open !== undefined;
  const open = props.open ?? true;
  const maximized = props.maximized ?? false;
  const localHostRef = useRef<HTMLDivElement | null>(null);
  const hostRef = props.hostRef ?? localHostRef;
  const { width, handlers } = props.inlineSize;
  // Derive suppression before the layout commits so the browser never creates
  // a width transition for resize changes.
  const [layoutTransition, setLayoutTransition] = useState(() => ({
    open,
    width,
    maximized,
    suppressed: false,
    tracksWidth: false,
  }));
  if (
    layoutTransition.open !== open ||
    layoutTransition.width !== width ||
    layoutTransition.maximized !== maximized
  ) {
    const openChanged = layoutTransition.open !== open;
    setLayoutTransition({
      open,
      width,
      maximized,
      suppressed: collapsible && !openChanged && layoutTransition.width !== width,
      // Opening and closing slide content of a fixed width. Maximizing or restoring keeps the
      // panel open, so its content follows the width instead of leaving a gap beside it.
      tracksWidth:
        !openChanged && (layoutTransition.tracksWidth || layoutTransition.maximized !== maximized),
    });
  }
  const suppressWidthTransition = layoutTransition.suppressed;
  useLayoutEffect(() => {
    if (!suppressWidthTransition) return;
    let restoreFrame = 0;
    const paintFrame = window.requestAnimationFrame(() => {
      restoreFrame = window.requestAnimationFrame(() => {
        setLayoutTransition((current) => ({ ...current, suppressed: false }));
      });
    });
    return () => {
      window.cancelAnimationFrame(paintFrame);
      window.cancelAnimationFrame(restoreFrame);
    };
  }, [suppressWidthTransition]);
  return (
    <div
      ref={hostRef}
      className={cn(
        "relative flex h-full min-h-0 min-w-0 max-w-full flex-col self-stretch bg-background",
        // Only this width animates; the sibling column fills the rest of the row. Maximized, the
        // width is the whole row, shrinking past siblings like the chat's agent rail, and nothing
        // sits beside the panel to rule off.
        !isInline ? "w-full" : !maximized && "border-l border-border",
        collapsible &&
          "[[data-panel-animations=true]_&]:transition-[width] [[data-panel-animations=true]_&]:duration-(--panel-animation-duration) [[data-panel-animations=true]_&]:ease-out",
        collapsible &&
          open &&
          "[[data-panel-animations=true]_&]:starting:w-(--preview-panel-closed-width)!",
        collapsible && !open && "pointer-events-none",
      )}
      style={
        isInline
          ? ({
              [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
              "--preview-panel-closed-width": props.closedWidth ?? "0px",
              width:
                collapsible && !open
                  ? (props.closedWidth ?? "0px")
                  : maximized && !props.keepWidthWhenMaximized
                    ? "100%"
                    : `var(${RESIZABLE_WIDTH_PROPERTY})`,
              transitionDuration: suppressWidthTransition ? "0ms" : undefined,
            } as CSSProperties)
          : undefined
      }
      data-preview-panel-mode={props.mode}
      data-preview-panel-maximized={maximized ? "true" : "false"}
    >
      {isInline && !maximized ? <RightPanelResizeHandle handlers={handlers} /> : null}
      {/* Pinned to the fixed right edge, so a rail at the end stays put while the panel closes. */}
      <div className={cn("h-full min-h-0 w-full", collapsible && "flex justify-end overflow-clip")}>
        <div
          className="flex h-full min-h-0 min-w-0 shrink-0 flex-col"
          style={
            collapsible
              ? {
                  width:
                    maximized || layoutTransition.tracksWidth
                      ? "100%"
                      : `calc(var(${RESIZABLE_WIDTH_PROPERTY}) - 1px)`,
                }
              : undefined
          }
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
