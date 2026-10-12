import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Claim the key so the world layout does not also close the chat.
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <div ref={menuRef} className="relative">
      <Button
        variant="glass"
        size="sm"
        aria-label={`Show or hide projects, ${shown} of ${props.projects.length} shown`}
        title="Show or hide projects"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <EyeIcon />
        <span className="tabular-nums">
          {shown} of {props.projects.length}
        </span>
      </Button>
      {open ? (
        <div className="absolute top-full right-0 mt-2 flex w-60 flex-col gap-0.5 rounded-xl border border-border/60 bg-popover/90 p-1.5 text-popover-foreground shadow-lg backdrop-blur">
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
      ) : null}
    </div>
  );
}
