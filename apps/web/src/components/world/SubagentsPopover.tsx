import { useMemo, useRef } from "react";

import type { SidebarThreadStatus } from "../Sidebar.logic";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import { type CharacterFacts, isResting } from "./engine/facts";

/** Hues follow the sidebar's: amber approval, indigo input, sky working. */
const STATUS = {
  approval: { label: "Approval", className: "bg-warning" },
  input: { label: "Input", className: "bg-indigo-500" },
  failed: { label: "Failed", className: "bg-error" },
  limited: { label: "Limited", className: "bg-warning" },
  working: { label: "Working", className: "bg-info" },
  waiting: { label: "Waiting", className: "bg-muted-foreground" },
  ready: { label: "Done", className: "bg-success" },
} satisfies Record<SidebarThreadStatus, { label: string; className: string }>;

/**
 * Lists the subagents one figure stands for, at the point it was clicked, so any one of them
 * can be opened. Picking one opens its chat.
 */
export function SubagentsPopover(props: {
  readonly point: { readonly x: number; readonly y: number };
  readonly subagents: ReadonlyArray<CharacterFacts>;
  /** The thread whose chat is open, marked in the list. */
  readonly activeKey: string | null;
  readonly onSelect: (subagent: CharacterFacts) => void;
  readonly onClose: () => void;
}) {
  const { point, subagents, activeKey, onSelect, onClose } = props;
  const anchor = useMemo(
    () => ({ getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) }),
    [point.x, point.y],
  );
  // In the order they were started.
  const rows = useMemo(
    () => subagents.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [subagents],
  );
  // Focus lands on the popup itself, so no row shows a focus ring on open; Tab still reaches them.
  const popupRef = useRef<HTMLDivElement>(null);

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverPopup
        ref={popupRef}
        initialFocus={popupRef}
        anchor={anchor}
        sideOffset={8}
        padding="compact"
        width="md"
      >
        <PopoverTitle className="mb-2">{rows.length} subagents</PopoverTitle>
        <ul className="-mx-1 flex max-h-[420px] flex-col overflow-y-auto">
          {rows.map((subagent) => {
            const status = STATUS[subagent.status];
            const label = isResting(subagent)
              ? formatRelativeTimeLabel(subagent.lastReplyAt)
              : status.label;
            return (
              <li key={subagent.key}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                    subagent.key === activeKey && "bg-accent/60",
                  )}
                  onClick={() => {
                    onSelect(subagent);
                    onClose();
                  }}
                >
                  <span className={cn("size-2 shrink-0 rounded-full", status.className)} />
                  <span className="min-w-0 flex-1 truncate">
                    {subagent.title || "Untitled thread"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverPopup>
    </Popover>
  );
}
