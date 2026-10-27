import {
  Columns3Icon,
  EyeIcon,
  EyeOffIcon,
  Grid2x2Icon,
  Rows3Icon,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { IslandIcon } from "../Icons";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import type { IslandArrangement } from "./engine/archipelago";
import { useWorldArrangementStore } from "./worldArrangementStore";
import { useWorldVisibilityStore } from "./worldVisibilityStore";

export const ARRANGEMENTS: ReadonlyArray<{
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
 * Removing asks first and is off without permission to change the project.
 */
export function IslandsMenu(props: {
  readonly projects: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly color: string;
    readonly removable: boolean;
  }>;
  readonly onRemove: (key: string) => void;
}) {
  const hidden = useWorldVisibilityStore((state) => state.hidden);
  const open = useWorldVisibilityStore((state) => state.menuOpen);
  const setOpen = useWorldVisibilityStore((state) => state.setMenuOpen);
  const toggleHidden = useWorldVisibilityStore((state) => state.toggleHidden);
  const arrangement = useWorldArrangementStore((state) => state.arrangement);
  const setArrangement = useWorldArrangementStore((state) => state.setArrangement);
  const shown = props.projects.filter((project) => !hidden[project.key]).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="glass" size="sm" />}
        aria-label={`Islands, ${shown} of ${props.projects.length} shown`}
        title="Islands"
      >
        <IslandIcon />
        <span className="tabular-nums">{shown}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" sideOffset={8} padding="compact" width="sm">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="flex-1 text-sm font-medium">Islands</span>
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
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {props.projects.map((project) => {
              const visible = !hidden[project.key];
              return (
                <li key={project.key} className="group flex items-center gap-0.5">
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
              );
            })}
          </ul>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
