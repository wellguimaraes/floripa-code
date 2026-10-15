import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, GitCommandError } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { FolderGit2Icon, GitCommitHorizontalIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { signTextColor } from "./scene/Sign";
import { type BranchTarget, branchRefsAtom } from "./useIslandSignStats";

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

/**
 * Every local branch across an island's checkouts, the default ones aside, most recently
 * committed first. Checkouts of one repository list the same branches, so each appears once.
 */
const islandBranchesAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as ReadonlyArray<BranchTarget>;
    const projectFolders = new Set(targets.flatMap((target) => target.roots));
    const rows = new Map<string, BranchRow>();
    let loading = false;
    for (const target of targets) {
      const result = get(branchRefsAtom(target));
      if (AsyncResult.isInitial(result)) loading = true;
      const repository = target.roots.at(-1) ?? target.cwd;
      for (const ref of Option.getOrNull(AsyncResult.value(result))?.refs ?? []) {
        if (ref.isRemote === true || ref.isDefault) continue;
        const rowKey = `${target.environmentId}\u0000${repository}\u0000${ref.name}`;
        if (rows.has(rowKey)) continue;
        rows.set(rowKey, {
          key: rowKey,
          environmentId: target.environmentId,
          cwd: target.cwd,
          name: ref.name,
          worktreePath: ref.worktreePath,
          inProjectFolder: ref.worktreePath !== null && projectFolders.has(ref.worktreePath),
          lastCommitAt: ref.lastCommitAt ?? null,
        });
      }
    }
    const sorted = [...rows.values()].toSorted(
      (a, b) =>
        (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? "") || a.name.localeCompare(b.name),
    );
    return { rows: sorted, loading };
  }),
);

/**
 * Lists an island's local branches with where each is checked out, when it was last committed
 * to and whether its worktree has uncommitted changes, each with a button that deletes it,
 * worktree and all. Deleting asks for a second click, and again if the branch isn't merged.
 */
export function IslandBranchesDialog(props: {
  readonly title: string;
  /** The island sign's colour; the header's project chip wears it. */
  readonly color: string;
  readonly targets: ReadonlyArray<BranchTarget>;
  readonly onClose: () => void;
}) {
  const { title, color, targets, onClose } = props;
  const chipStyle = useMemo(
    () => ({ backgroundColor: color, color: signTextColor(color) }),
    [color],
  );
  const { rows, loading } = useAtomValue(islandBranchesAtom(JSON.stringify(targets)));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-h-[min(560px,calc(100dvh-2rem))] max-w-lg [--glass-opacity:100%]">
        <DialogHeader>
          <span
            className={cn(
              "max-w-full self-start truncate rounded-md px-1.5",
              "text-xs leading-5 font-semibold",
            )}
            style={chipStyle}
          >
            {title}
          </span>
          <DialogTitle>Local Branches</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {rows.length === 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              {loading ? <Spinner size="sm" tone="muted" /> : null}
              {loading ? "Loading branches…" : "No branches besides the default one."}
            </p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {rows.map((row) => (
                <BranchItem key={row.key} row={row} />
              ))}
            </ul>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

type DeleteStep = "idle" | "confirm" | "unmerged" | "deleting";

function BranchItem({ row }: { readonly row: BranchRow }) {
  const status = useEnvironmentQuery(
    row.worktreePath === null
      ? null
      : vcsEnvironment.status({
          environmentId: row.environmentId,
          input: { cwd: row.worktreePath },
        }),
  );
  const dirty = status.data?.hasWorkingTreeChanges === true;
  const allowed = useAtomValue(vcsEnvironment.deleteRef.permissionAtom(row.environmentId));
  const deleteRef = useAtomCommand(vcsEnvironment.deleteRef, { reportFailure: false });
  const [step, setStep] = useState<DeleteStep>("idle");

  // A confirming click only counts for a moment; after that the button goes back to Delete.
  useEffect(() => {
    if (step !== "confirm" && step !== "unmerged") return;
    const timer = window.setTimeout(() => setStep("idle"), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [step]);

  const remove = async (force: boolean) => {
    setStep("deleting");
    const result = await deleteRef({
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
      title: `Could not delete ${row.name}`,
      description: failure instanceof Error ? failure.message : undefined,
    });
  };

  const blockedReason = row.inProjectFolder
    ? "Checked out in the project folder"
    : !allowed
      ? "You don't have permission to change this repository"
      : null;

  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{row.name}</p>
        <p className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          {row.lastCommitAt !== null ? (
            <span className="flex shrink-0 items-center gap-1" aria-label="Last commit">
              <GitCommitHorizontalIcon className="size-3" />
              {formatRelativeTimeLabel(row.lastCommitAt)}
            </span>
          ) : null}
          {row.worktreePath !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex min-w-0 items-center gap-1">
                    <FolderGit2Icon className="size-3 shrink-0" />
                    <span className="truncate">
                      {row.inProjectFolder ? "Project folder" : lastSegment(row.worktreePath)}
                    </span>
                  </span>
                }
              />
              <TooltipPopup>{row.worktreePath}</TooltipPopup>
            </Tooltip>
          ) : null}
          {dirty ? (
            <span className="flex shrink-0 items-center gap-1 text-warning-foreground">
              <span className="size-1.5 rounded-full bg-warning" />
              Uncommitted changes
            </span>
          ) : null}
        </p>
      </div>
      <DeleteButton
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
  readonly step: DeleteStep;
  readonly blockedReason: string | null;
  readonly onClick: () => void;
}) {
  const { step, blockedReason, onClick } = props;
  const label =
    step === "deleting"
      ? "Deleting…"
      : step === "confirm"
        ? "Confirm"
        : step === "unmerged"
          ? "Not merged — delete anyway"
          : "Delete";
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

/** The last folder of a path, e.g. a worktree's name. */
function lastSegment(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? path;
}
