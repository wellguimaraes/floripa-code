import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  Columns3Icon,
  EyeIcon,
  EyeOffIcon,
  Grid2x2Icon,
  PinIcon,
  PinOffIcon,
  Rows3Icon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useState } from "react";

import { cn } from "../../lib/utils";
import { IslandIcon } from "../Icons";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { IslandArrangement } from "./engine/archipelago";
import { useWorldArrangementStore } from "./worldArrangementStore";
import { useWorldVisibilityStore } from "./worldVisibilityStore";

const ARRANGEMENTS: ReadonlyArray<{
  readonly value: IslandArrangement;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { value: "column", label: "Vertical", icon: Rows3Icon },
  { value: "grid", label: "Grid", icon: Grid2x2Icon },
  { value: "row", label: "Horizontal", icon: Columns3Icon },
];

/**
 * Top bar pill that counts the islands on the map. Its popover picks how they line
 * up, and lists every project with its sign colour to show, hide, or remove it.
 * Removing asks first and is off without permission to change the project. Pinned projects
 * lead the list; archived ones trail it under their own heading, where they can be restored.
 */
export function IslandsMenu(props: {
  readonly projects: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly color: string;
    readonly removable: boolean;
    /** Whether this connection and every server involved can pin and archive it. */
    readonly organizable: boolean;
    readonly pinned: boolean;
    readonly archived: boolean;
  }>;
  readonly onRemove: (key: string) => void;
  readonly onPin: (key: string, pinned: boolean) => void;
  readonly onArchive: (key: string, archived: boolean) => void;
}) {
  const hidden = useWorldVisibilityStore((state) => state.hidden);
  const open = useWorldVisibilityStore((state) => state.menuOpen);
  const setOpen = useWorldVisibilityStore((state) => state.setMenuOpen);
  const menuAt = useWorldVisibilityStore((state) => state.menuAt);
  const toggleHidden = useWorldVisibilityStore((state) => state.toggleHidden);
  const arrangement = useWorldArrangementStore((state) => state.arrangement);
  const setArrangement = useWorldArrangementStore((state) => state.setArrangement);
  // Pinned first, archived last; each group keeps the map's order.
  const orderedProjects = [
    ...props.projects.filter((project) => !project.archived && project.pinned),
    ...props.projects.filter((project) => !project.archived && !project.pinned),
    ...props.projects.filter((project) => project.archived),
  ];
  const shown = props.projects.filter((project) => !hidden[project.key]).length;
  const total = props.projects.length;
  const liveCount = shown === total ? `${shown}` : `${shown} of ${total}`;
  // Held while the popover is open so toggling islands does not resize the trigger and
  // shift the popover under the pointer. The rows inside show the live state.
  const [count, setCount] = useState(liveCount);
  if (!open && count !== liveCount) setCount(liveCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="glass" />}
        aria-label={`Lands, ${shown} of ${total} shown`}
        title="Lands"
      >
        <IslandIcon />
        <span className="tabular-nums">{count}</span>
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        sideOffset={menuAt === null ? 8 : 0}
        anchor={
          menuAt === null
            ? undefined
            : { getBoundingClientRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }
        }
        padding="none"
        width="sm"
      >
        <div className="flex flex-col">
          {/* Rows below pad 6+6, so the title, dots, and toggle all sit 12px from the edges. */}
          <div className="flex items-center gap-2 border-b p-3">
            <span className="flex-1 text-sm font-medium">Lands</span>
            <ToggleGroup
              aria-label="Arrange islands"
              value={[arrangement]}
              onValueChange={(next) => {
                const option = ARRANGEMENTS.find((candidate) => candidate.value === next[0]);
                if (option !== undefined) setArrangement(option.value);
              }}
            >
              {ARRANGEMENTS.map((option) => (
                <Toggle
                  key={option.value}
                  value={option.value}
                  aria-label={option.label}
                  title={option.label}
                >
                  <option.icon className="size-3.5" />
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          <ul className="flex max-h-80 flex-col overflow-y-auto p-1.5">
            {orderedProjects.map((project, index) => {
              const visible = !hidden[project.key];
              return (
                <Fragment key={project.key}>
                  {project.archived && !orderedProjects[index - 1]?.archived ? (
                    <li className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                      Archived
                    </li>
                  ) : null}
                  <li className="group flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-pressed={visible}
                      aria-label={`${visible ? "Hide" : "Show"} ${project.title}`}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                        !visible && "text-muted-foreground",
                      )}
                      onClick={() => toggleHidden(project.key)}
                    >
                      <span
                        aria-hidden
                        className={cn("size-2.5 shrink-0 rounded-full", !visible && "opacity-40")}
                        style={{ backgroundColor: project.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{project.title}</span>
                      {visible ? (
                        <EyeIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <EyeOffIcon className="size-3.5 shrink-0" />
                      )}
                    </button>
                    {project.organizable && !project.archived ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${project.pinned ? "Unpin" : "Pin"} ${project.title}`}
                        title={project.pinned ? "Unpin project" : "Pin project"}
                        onClick={() => props.onPin(project.key, !project.pinned)}
                      >
                        {project.pinned ? <PinOffIcon /> : <PinIcon />}
                      </Button>
                    ) : null}
                    {project.organizable ? (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${project.archived ? "Unarchive" : "Archive"} ${project.title}`}
                        title={project.archived ? "Unarchive project" : "Archive project"}
                        onClick={() => props.onArchive(project.key, !project.archived)}
                      >
                        {project.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${project.title}…`}
                      title="Remove project…"
                      disabled={!project.removable}
                      onClick={() => {
                        // The confirmation dialog takes over, so the popover gets out of its way.
                        setOpen(false);
                        props.onRemove(project.key);
                      }}
                    >
                      <Trash2Icon />
                    </Button>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
