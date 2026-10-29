import * as Schema from "effect/Schema";
import { SquareSplitHorizontalIcon, SquareSplitVerticalIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { cn } from "~/lib/utils";

import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { Toggle } from "../ui/toggle";
import { ToggleGroup } from "../ui/toggle-group";

/** "horizontal" puts the tree beside the diff, "vertical" stacks it above. */
export type DiffFileTreeLayout = "horizontal" | "vertical";

const DiffFileTreeLayoutSchema = Schema.Literals(["horizontal", "vertical"]);
const DIFF_FILE_TREE_LAYOUT_STORAGE_KEY = "floripacode.diffFileTreeLayout";

/** One arrangement for every diff with a file tree, so the thread and PR views agree. */
export function useDiffFileTreeLayout() {
  return useLocalStorage<DiffFileTreeLayout, DiffFileTreeLayout>(
    DIFF_FILE_TREE_LAYOUT_STORAGE_KEY,
    "horizontal",
    DiffFileTreeLayoutSchema,
  );
}

export function DiffFileTreeLayoutToggle({
  layout,
  onLayoutChange,
}: {
  readonly layout: DiffFileTreeLayout;
  readonly onLayoutChange: (layout: DiffFileTreeLayout) => void;
}) {
  return (
    <ToggleGroup
      aria-label="File tree arrangement"
      className="shrink-0"
      value={[layout]}
      onValueChange={(value) => {
        const next = value[0];
        if (next === "horizontal" || next === "vertical") onLayoutChange(next);
      }}
    >
      <Toggle aria-label="Files beside the diff" value="horizontal">
        <SquareSplitHorizontalIcon className="size-3.5" />
      </Toggle>
      <Toggle aria-label="Files above the diff" value="vertical">
        <SquareSplitVerticalIcon className="size-3.5" />
      </Toggle>
    </ToggleGroup>
  );
}

interface DiffFileTreePaneProps {
  readonly layout: DiffFileTreeLayout;
  /** Prefix for the remembered size; each layout keeps its own. */
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The tree's side of a diff, resized from the edge it shares with the diff. The diff keeps at
 * least 12rem either way. Place it first in a flex row, or a flex column for "vertical".
 */
export function DiffFileTreePane({
  layout,
  storageKey,
  defaultWidth,
  minWidth,
  className,
  children,
}: DiffFileTreePaneProps) {
  const vertical = layout === "vertical";
  const size = useResizableWidth({
    storageKey: vertical ? `${storageKey}Height` : `${storageKey}Width`,
    defaultWidth: vertical ? 224 : defaultWidth,
    minWidth: vertical ? 96 : minWidth,
    maxWidth: 640,
    edge: vertical ? "bottom" : "right",
  });
  return (
    <aside
      className={cn(
        "relative flex shrink-0 border-border/60",
        vertical
          ? "h-(--resizable-width) max-h-[calc(100%-12rem)] border-b"
          : "w-(--resizable-width) max-w-[calc(100%-12rem)] border-r",
        className,
      )}
      style={{ [RESIZABLE_WIDTH_PROPERTY]: `${size.width}px` } as CSSProperties}
    >
      {vertical ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          className="group absolute inset-x-0 -bottom-1 z-20 h-2 cursor-row-resize select-none"
          {...size.handlers}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-active:bg-primary/60"
          />
        </div>
      ) : (
        <RightPanelResizeHandle handlers={size.handlers} className="right-[-5px] left-auto" />
      )}
      {children}
    </aside>
  );
}
