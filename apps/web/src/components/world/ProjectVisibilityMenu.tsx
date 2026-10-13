import { EyeIcon, EyeOffIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useWorldVisibilityStore } from "./worldVisibilityStore";

/**
 * Top bar menu that shows or hides each project's island. An eye button
 * that counts the shown projects opens a popover listing every project with its sign colour. A press
 * anywhere outside the menu, or Escape, closes it.
 */
export function ProjectVisibilityMenu(props: {
  readonly projects: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly color: string;
  }>;
}) {
  const hidden = useWorldVisibilityStore((state) => state.hidden);
  const open = useWorldVisibilityStore((state) => state.menuOpen);
  const setOpen = useWorldVisibilityStore((state) => state.setMenuOpen);
  const toggleHidden = useWorldVisibilityStore((state) => state.toggleHidden);
  const shown = props.projects.filter((project) => !hidden[project.key]).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="glass" size="sm" />}
        aria-label={`Show or hide projects, ${shown} of ${props.projects.length} shown`}
        title="Show or hide projects"
      >
        <EyeIcon />
        <span className="tabular-nums">
          {shown} of {props.projects.length}
        </span>
      </PopoverTrigger>
      <PopoverPopup align="start" sideOffset={8} padding="compact" width="sm">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 px-2 py-1">
            <span className="flex-1 text-sm font-medium">Projects</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {shown} of {props.projects.length}
            </span>
          </div>
          <ul className="flex max-h-80 flex-col overflow-y-auto">
            {props.projects.map((project) => {
              const visible = !hidden[project.key];
              return (
                <li key={project.key}>
                  <button
                    type="button"
                    aria-pressed={visible}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
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
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
