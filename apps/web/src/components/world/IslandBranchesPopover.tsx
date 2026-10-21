import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, GitCommandError, type ScopedThreadRef } from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  FolderGit2Icon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  PanelRightIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { ProjectFaviconProject } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { signTextColor } from "./scene/Sign";
import { type BranchTarget, branchRefsAtom } from "./useIslandSignStats";
import { WorldProjectPill } from "./WorldProjectPill";

const isGitCommandError = Schema.is(GitCommandError);

/** How long a Delete button waits for its confirming second click. */
const CONFIRM_MS = 4_000;

interface BranchRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  /** The checkout the branch belongs to, where it's deleted from. */
  readonly cwd: string;
  readonly name: string;
  readonly worktreePath: string | null;
  /** Checked out in a project's own folder, which can't be removed from here. */
  readonly inProjectFolder: boolean;
  readonly lastCommitAt: string | null;
}

type IslandList = "branches" | "worktrees";

/**
 * An island's local branches, the default ones aside, most recently committed first, and its
 * worktrees whatever branch they're on, the main one in its projects' own folders first.
 * Checkouts of one repository list the same branches, so each appears once.
 */
const islandBranchesAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as ReadonlyArray<BranchTarget>;
    const projectFolders = new Set(targets.flatMap((target) => target.roots));
    const branches = new Map<string, BranchRow>();
    const worktrees = new Map<string, BranchRow>();
    let loading = false;
    for (const target of targets) {
      const result = get(branchRefsAtom(target));
      if (AsyncResult.isInitial(result)) loading = true;
      const repository = target.roots.at(-1) ?? target.cwd;
      for (const ref of Option.getOrNull(AsyncResult.value(result))?.refs ?? []) {
        if (ref.isRemote === true) continue;
        const row = {
          environmentId: target.environmentId,
          cwd: target.cwd,
          name: ref.name,
          worktreePath: ref.worktreePath,
          inProjectFolder: ref.worktreePath !== null && projectFolders.has(ref.worktreePath),
          lastCommitAt: ref.lastCommitAt ?? null,
        };
        const branchKey = `${target.environmentId}\u0000${repository}\u0000${ref.name}`;
        if (!ref.isDefault && !branches.has(branchKey)) {
          branches.set(branchKey, { key: branchKey, ...row });
        }
        if (ref.worktreePath === null) continue;
        const worktreeKey = `${target.environmentId}\u0000${ref.worktreePath}`;
        if (!worktrees.has(worktreeKey)) worktrees.set(worktreeKey, { key: worktreeKey, ...row });
      }
    }
    const byLastCommit = (a: BranchRow, b: BranchRow) =>
      (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? "") || a.name.localeCompare(b.name);
    return {
      branches: [...branches.values()].toSorted(byLastCommit),
      worktrees: [...worktrees.values()].toSorted(
        (a, b) => Number(b.inProjectFolder) - Number(a.inProjectFolder) || byLastCommit(a, b),
      ),
      loading,
    };
  }),
);

/**
 * Lists an island's local branches or its worktrees, with when each was last committed to and
 * whether its worktree has uncommitted changes, in a popover at the sign where it was asked for.
 * Each branch has a button that deletes it, worktree and all; each worktree one that removes the
 * worktree and keeps its branch. Both ask for a second click, and deleting a branch asks again
 * if it isn't merged.
 */
export function IslandBranchesPopover(props: {
  readonly list: IslandList;
  /** Where on screen the sign was clicked; the popover opens there. */
  readonly point: { readonly x: number; readonly y: number };
  readonly title: string;
  /** The project whose icon leads the header's pill. */
  readonly project: ProjectFaviconProject | null;
  /** The island sign's colour; the header's project pill wears it. */
  readonly color: string;
  readonly targets: ReadonlyArray<BranchTarget>;
  /** The thread whose surfaces a worktree's button opens: its latest agent's; null with none. */
  readonly surfacesThreadOf: (worktree: {
    readonly path: string;
    readonly inProjectFolder: boolean;
  }) => ScopedThreadRef | null;
  /** Shows just that worktree's surfaces, its chat collapsed. */
  readonly onOpenSurfaces: (ref: ScopedThreadRef) => void;
  readonly onClose: () => void;
}) {
  const { list, point, title, project, color, targets, onClose } = props;
  const { surfacesThreadOf, onOpenSurfaces } = props;
  const plate = useMemo(() => ({ background: color, text: signTextColor(color) }), [color]);
  const anchor = useMemo(
    () => ({ getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) }),
    [point.x, point.y],
  );
  const lists = useAtomValue(islandBranchesAtom(JSON.stringify(targets)));
  const rows = lists[list];
  const loading = lists.loading;
  // Focus lands on the popup itself, so no row action shows a focus ring on open; Tab still
  // reaches them.
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
        align="start"
        sideOffset={8}
        width="lg"
        padding="compact"
      >
        <div className="flex flex-col gap-1.5 pt-1 pb-2">
          <WorldProjectPill size="sm" project={project} name={title} plate={plate} />
          <PopoverTitle>{list === "branches" ? "Local Branches" : "Worktrees"}</PopoverTitle>
        </div>
        <Separator className="-mx-3 mb-1 data-[orientation=horizontal]:w-auto" />
        {rows.length === 0 ? (
          <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            {loading ? <Spinner size="sm" tone="muted" /> : null}
            {list === "branches"
              ? loading
                ? "Loading branches…"
                : "No branches besides the default one."
              : loading
                ? "Loading worktrees…"
                : "No worktrees."}
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {rows.map((row) => (
              <BranchItem
                key={row.key}
                list={list}
                row={row}
                surfacesThread={
                  list === "worktrees" && row.worktreePath !== null
                    ? surfacesThreadOf({
                        path: row.worktreePath,
                        inProjectFolder: row.inProjectFolder,
                      })
                    : undefined
                }
                onOpenSurfaces={(ref) => {
                  onOpenSurfaces(ref);
                  onClose();
                }}
              />
            ))}
          </ul>
        )}
      </PopoverPopup>
    </Popover>
  );
}

type DeleteStep = "idle" | "confirm" | "unmerged" | "deleting";

function BranchItem({
  list,
  row,
  surfacesThread,
  onOpenSurfaces,
}: {
  readonly list: IslandList;
  readonly row: BranchRow;
  /** Worktree rows only: the thread to open its surfaces with, null when no agent works there. */
  readonly surfacesThread: ScopedThreadRef | null | undefined;
  readonly onOpenSurfaces: (ref: ScopedThreadRef) => void;
}) {
  const status = useEnvironmentQuery(
    row.worktreePath === null
      ? null
      : vcsEnvironment.status({
          environmentId: row.environmentId,
          input: { cwd: row.worktreePath },
        }),
  );
  const dirty = status.data?.hasWorkingTreeChanges === true;
  const workingTree = status.data?.workingTree;
  const untracked = workingTree?.untracked ?? 0;
  const command = list === "branches" ? vcsEnvironment.deleteRef : vcsEnvironment.removeWorktree;
  const allowed = useAtomValue(command.permissionAtom(row.environmentId));
  const deleteRef = useAtomCommand(vcsEnvironment.deleteRef, { reportFailure: false });
  const removeWorktree = useAtomCommand(vcsEnvironment.removeWorktree, { reportFailure: false });
  // In the worktree list, the row is the worktree and its button removes just that.
  const worktree = list === "worktrees" ? row.worktreePath : null;
  // A worktree folder named for its first, temporary branch (`t3-8f432bc3`) says nothing, so
  // that worktree goes by its branch, which is renamed for the work, and the folder moves to
  // the details.
  const generatedFolder = worktree !== null && isTemporaryWorktreeBranch(lastSegment(worktree));
  const [step, setStep] = useState<DeleteStep>("idle");

  // A confirming click only counts for a moment; after that the button goes back to Delete.
  useEffect(() => {
    if (step !== "confirm" && step !== "unmerged") return;
    const timer = window.setTimeout(() => setStep("idle"), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [step]);

  const remove = async (force: boolean) => {
    setStep("deleting");
    const result =
      worktree !== null
        ? // Removing a worktree throws its uncommitted changes away, like deleting its branch.
          await removeWorktree({
            environmentId: row.environmentId,
            input: { cwd: row.cwd, path: worktree, force: true },
          })
        : await deleteRef({
            environmentId: row.environmentId,
            input: { cwd: row.cwd, refName: row.name, ...(force ? { force: true } : {}) },
          });
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) {
      setStep("idle");
      return;
    }
    const failure = squashAtomCommandFailure(result);
    if (isGitCommandError(failure) && failure.reason === "branch_not_fully_merged") {
      setStep("unmerged");
      return;
    }
    setStep("idle");
    toastManager.add({
      type: "error",
      title:
        worktree !== null
          ? `Could not remove ${lastSegment(worktree)}`
          : `Could not delete ${row.name}`,
      description: failure instanceof Error ? failure.message : undefined,
    });
  };

  const blockedReason = row.inProjectFolder
    ? worktree !== null
      ? "The main worktree can't be removed"
      : "Checked out in the project folder"
    : !allowed
      ? "You don't have permission to change this repository"
      : null;

  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-sm">
          {worktree === null || generatedFolder
            ? row.name
            : row.inProjectFolder
              ? "Main worktree"
              : lastSegment(worktree)}
        </p>
        <p className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          {worktree !== null && !generatedFolder ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex min-w-0 items-center gap-1">
                    <GitBranchIcon className="size-3 shrink-0" />
                    <span className="truncate">{row.name}</span>
                  </span>
                }
              />
              <TooltipPopup>{worktree}</TooltipPopup>
            </Tooltip>
          ) : null}
          {row.lastCommitAt !== null ? (
            <span className="flex shrink-0 items-center gap-1" aria-label="Last commit">
              <GitCommitHorizontalIcon className="size-3" />
              {formatRelativeTimeLabel(row.lastCommitAt)}
            </span>
          ) : null}
          {row.worktreePath !== null &&
          (worktree === null || row.inProjectFolder || generatedFolder) ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex min-w-0 items-center gap-1">
                    <FolderGit2Icon className="size-3 shrink-0" />
                    <span className="truncate">
                      {row.inProjectFolder && worktree === null
                        ? "Project folder"
                        : lastSegment(row.worktreePath)}
                    </span>
                  </span>
                }
              />
              <TooltipPopup>{row.worktreePath}</TooltipPopup>
            </Tooltip>
          ) : null}
        </p>
        {dirty ? (
          <p className="flex min-w-0 items-center gap-1 text-xs text-warning-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-warning" />
            <span className="truncate">Uncommitted changes</span>
            {workingTree && workingTree.insertions + workingTree.deletions > 0 ? (
              <span className="shrink-0 font-mono">
                <span className="text-diff-addition-foreground">+{workingTree.insertions}</span>{" "}
                <span className="text-diff-deletion-foreground">−{workingTree.deletions}</span>
              </span>
            ) : null}
            {untracked > 0 ? <span className="shrink-0">· {untracked} untracked</span> : null}
          </p>
        ) : status.data !== undefined ? (
          // Said outright, so a clean worktree doesn't read as one whose status hasn't loaded.
          <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
            <span className="truncate">No uncommitted changes</span>
          </p>
        ) : null}
      </div>
      {surfacesThread !== undefined ? (
        <SurfacesButton thread={surfacesThread} onOpen={onOpenSurfaces} />
      ) : null}
      <DeleteButton
        verb={worktree !== null ? "Remove" : "Delete"}
        step={step}
        blockedReason={blockedReason}
        onClick={() => {
          if (step === "idle") setStep("confirm");
          else if (step === "confirm") void remove(false);
          else if (step === "unmerged") void remove(true);
        }}
      />
    </li>
  );
}

function DeleteButton(props: {
  readonly verb: "Delete" | "Remove";
  readonly step: DeleteStep;
  readonly blockedReason: string | null;
  readonly onClick: () => void;
}) {
  const { verb, step, blockedReason, onClick } = props;
  const label =
    step === "deleting"
      ? verb === "Delete"
        ? "Deleting…"
        : "Removing…"
      : step === "confirm"
        ? "Confirm"
        : step === "unmerged"
          ? "Not merged — delete anyway"
          : verb;
  const button = (
    <Button
      type="button"
      variant={step === "confirm" || step === "unmerged" ? "destructive" : "outline"}
      size="xs"
      className="shrink-0"
      disabled={blockedReason !== null || step === "deleting"}
      onClick={onClick}
    >
      <Trash2Icon className="size-3.5" />
      {label}
    </Button>
  );
  if (blockedReason === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="shrink-0">{button}</span>} />
      <TooltipPopup>{blockedReason}</TooltipPopup>
    </Tooltip>
  );
}

/** Opens a worktree's surfaces on their own; they belong to a thread, so it needs an agent there. */
function SurfacesButton(props: {
  readonly thread: ScopedThreadRef | null;
  readonly onOpen: (ref: ScopedThreadRef) => void;
}) {
  const { thread, onOpen } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="shrink-0">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label="Open surfaces"
              disabled={thread === null}
              onClick={() => {
                if (thread !== null) onOpen(thread);
              }}
            >
              <PanelRightIcon />
            </Button>
          </span>
        }
      />
      <TooltipPopup>
        {thread === null ? "No agent works in this worktree yet" : "Open surfaces"}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The last folder of a path, e.g. a worktree's name. */
function lastSegment(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? path;
}
