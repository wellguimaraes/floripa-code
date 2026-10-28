import { FolderGit2Icon, FolderGitIcon, FolderIcon, UserIcon, XIcon } from "lucide-react";
import { type KeyboardEvent, lazy, Suspense, useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { WorldAgentWorkspace } from "./useStartWorldAgent";

const HatPortrait = lazy(() =>
  import("./scene/CharacterPortrait").then((module) => ({ default: module.HatPortrait })),
);

export interface PickableWorkspace {
  readonly value: string;
  readonly label: string;
  /** A second line, such as the branch the main worktree is on. */
  readonly detail: string | null;
  readonly workspace: WorldAgentWorkspace;
  /** The hat its agents wear in the world, if any work there. */
  readonly hat: number | null;
  /** How many agents on the island work there now. */
  readonly agents: number;
}

export function WorkspaceIcon(props: {
  readonly workspace: WorldAgentWorkspace;
  readonly className?: string;
}) {
  const { workspace, className } = props;
  return workspace.kind === "new-worktree" ? (
    <FolderGit2Icon className={className} />
  ) : workspace.kind === "worktree" ? (
    <FolderGitIcon className={className} />
  ) : (
    <FolderIcon className={className} />
  );
}

/**
 * The new-agent bubble's first step in a git project: where the agent works.
 * One row per workspace; the up and down arrows move between them, Enter or a
 * click picks one, Escape closes the bubble.
 */
export function NewAgentWorkspacePicker(props: {
  readonly islandName: string;
  readonly workspaces: ReadonlyArray<PickableWorkspace>;
  /** The button picked first: the project's default workspace. */
  readonly defaultValue: string;
  readonly onPick: (workspace: WorldAgentWorkspace) => void;
  readonly onClose: () => void;
}) {
  const { islandName, workspaces, defaultValue, onPick, onClose } = props;
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // Null until an arrow key moves it, so a default that resolves late (git, settings) still applies.
  const [moved, setMoved] = useState<string | null>(null);
  const has = (value: string | null): value is string =>
    value !== null && workspaces.some((item) => item.value === value);
  const active = has(moved) ? moved : has(defaultValue) ? defaultValue : workspaces[0]?.value;
  useLayoutEffect(() => {
    if (active !== undefined) buttons.current.get(active)?.focus();
  }, [active]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      // Handled here, so the world's own Escape (closing the chat panel) leaves it alone.
      event.stopPropagation();
      onClose();
      return;
    }
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = workspaces.findIndex((item) => item.value === active) + step;
    if (next >= 0 && next < workspaces.length) setMoved(workspaces[next]!.value);
  };

  return (
    <div
      tabIndex={-1}
      className="flex w-140 flex-col gap-2.5 rounded-xl border border-border bg-popover p-2.5 text-popover-foreground shadow-lg outline-none"
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">New agent</span>
          <span className="truncate text-xs text-muted-foreground">
            on {islandName} · where should it work?
          </span>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="-m-1 flex max-h-72 flex-col gap-1.5 overflow-y-auto p-1">
        {workspaces.map((item) => (
          <button
            key={item.value}
            ref={(button) => {
              if (button === null) buttons.current.delete(item.value);
              else buttons.current.set(item.value, button);
            }}
            type="button"
            tabIndex={item.value === active ? 0 : -1}
            onClick={() => onPick(item.workspace)}
            className={cn(
              "flex h-11 min-w-0 shrink-0 items-center gap-2.5 rounded-lg border border-border px-3 text-left",
              "bg-muted/40 outline-none transition-colors hover:bg-accent",
              // Marks the arrow keys' place from the start, not only after a key press.
              item.value === active && "border-primary bg-accent ring-2 ring-primary/40",
            )}
          >
            {item.hat === null ? (
              <WorkspaceIcon workspace={item.workspace} className="size-4 shrink-0 opacity-70" />
            ) : (
              <Suspense fallback={<div className="-mx-0.5 size-5 shrink-0" />}>
                <HatPortrait hat={item.hat} className="-mx-0.5 size-5" />
              </Suspense>
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.label}</span>
            {item.agents > 0 ? (
              <Badge
                variant="secondary"
                size="sm"
                aria-label={`${item.agents} ${item.agents === 1 ? "agent" : "agents"} working here`}
              >
                <UserIcon />
                {item.agents}
              </Badge>
            ) : null}
            {item.detail !== null ? (
              <span className="max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
                {item.detail}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted-foreground">
        Arrows to move · Enter to pick · Esc to close
      </span>
    </div>
  );
}
