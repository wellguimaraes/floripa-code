import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { worktreeScopeKey } from "@t3tools/shared/worktreeScope";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, FolderGit2Icon } from "lucide-react";
import { memo, useMemo } from "react";

import { cn } from "~/lib/utils";
import { useThreadShellsForProjectRefs } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";
import { useThreadWorktreeScope } from "~/worktreeScope";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

interface WorktreeEntry {
  scopeKey: string;
  name: string;
  branch: string | null;
  /** The thread to open there: the one the user wrote to most recently. */
  thread: ScopedThreadRef;
  agentCount: number;
}

/** The last folder of a path, e.g. a worktree's name. */
function lastSegment(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? path;
}

/**
 * Where the thread works: its worktree, plus the branch when the folder name
 * does not already say it. The menu lists the project's other worktrees that
 * have agents and opens the most recent agent in the one picked; its surfaces
 * come with it.
 */
export const WorktreeSwitcher = memo(function WorktreeSwitcher(props: {
  readonly threadRef: ScopedThreadRef;
  readonly className?: string;
}) {
  const navigate = useNavigate();
  const scope = useThreadWorktreeScope(props.threadRef);
  const projectRefs = useMemo(
    () => (scope ? [scopeProjectRef(scope.environmentId, scope.projectId)] : []),
    [scope],
  );
  const shells = useThreadShellsForProjectRefs(projectRefs);
  const entries = useMemo(() => {
    if (!scope) return [];
    const byScope = new Map<string, WorktreeEntry & { latest: string }>();
    for (const shell of shells) {
      if (shell.archivedAt !== null || shell.environmentId !== scope.environmentId) continue;
      const key = worktreeScopeKey({
        worktreePath: shell.worktreePath,
        workspaceRoot: scope.workspaceRoot,
      });
      const latest = shell.latestUserMessageAt ?? "";
      const existing = byScope.get(key);
      if (existing) {
        existing.agentCount += 1;
        if (latest > existing.latest) {
          existing.latest = latest;
          existing.thread = scopeThreadRef(shell.environmentId, shell.id);
          existing.branch = shell.branch;
        }
        continue;
      }
      byScope.set(key, {
        scopeKey: key,
        name:
          key === worktreeScopeKey({ workspaceRoot: scope.workspaceRoot })
            ? "Main worktree"
            : lastSegment(key),
        branch: shell.branch,
        thread: scopeThreadRef(shell.environmentId, shell.id),
        agentCount: 1,
        latest,
      });
    }
    return [...byScope.values()].toSorted((left, right) => right.latest.localeCompare(left.latest));
  }, [scope, shells]);

  if (!scope) return null;
  const current = entries.find((entry) => entry.scopeKey === scope.scopeKey);
  const name = scope.worktreePath === null ? "Main worktree" : lastSegment(scope.worktreePath);
  const branch = current?.branch ?? null;
  const showBranch = branch !== null && branch !== name && !branch.endsWith(`/${name}`);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Worktree ${name}${showBranch ? `, branch ${branch}` : ""}`}
            className={cn(
              "flex min-w-0 cursor-pointer items-center gap-1 rounded-sm text-xs leading-4 text-muted-foreground hover:text-foreground",
              props.className,
            )}
          />
        }
      >
        <FolderGit2Icon className="size-3 shrink-0" />
        <span className="truncate">{name}</span>
        {showBranch ? (
          <>
            <span aria-hidden className="text-muted-foreground/60">
              /
            </span>
            <span className="truncate">{branch}</span>
          </>
        ) : null}
        <ChevronDownIcon className="size-3 shrink-0" />
      </MenuTrigger>
      <MenuPopup align="start" side="bottom" sideOffset={6} className="max-w-80">
        {entries.map((entry) => (
          <MenuItem
            key={entry.scopeKey}
            disabled={entry.scopeKey === scope.scopeKey}
            onClick={() =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: buildThreadRouteParams(entry.thread),
              })
            }
          >
            <span className="min-w-0 flex-1 truncate">
              {entry.name}
              {entry.branch && entry.branch !== entry.name ? ` / ${entry.branch}` : ""}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {entry.agentCount} {entry.agentCount === 1 ? "agent" : "agents"}
            </span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
});
