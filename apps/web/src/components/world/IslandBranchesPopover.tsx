import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, GitCommandError } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  FileDiffIcon,
  FolderGit2Icon,
  GitCommitHorizontalIcon,
  PanelRightIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { refreshArchivedThreadsForEnvironment } from "../../lib/archivedThreadsState";
import { cn, randomUUID } from "../../lib/utils";
import { useGitStackedAction, useVcsPullAction } from "../../state/sourceControlActions";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { PrStatusTooltipContent, prStatusIndicator } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import { RefreshIcon } from "../ui/refresh-icon";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type BranchTarget, branchRefsAtom, isStale } from "./useIslandSignStats";
import { useWorldIslandPrefsStore } from "./worldIslandPrefsStore";

const HatPortrait = lazy(() =>
  import("./scene/CharacterPortrait").then((module) => ({ default: module.HatPortrait })),
);

const isGitCommandError = Schema.is(GitCommandError);

/** How long a Delete button waits for its confirming second click. */
const CONFIRM_MS = 4_000;
/**
 * How often an open popover reads its branches again. Just the local refs: a worktree's full
 * status fetches the remote and looks its PR up, so only opening and the refresh button do.
 */
const POLL_MS = 5_000;

/**
 * Where a branch's delete is at: still running, or done but not yet gone from the listed refs,
 * both of which hide its row; or refused as unmerged, which brings it back to delete anyway.
 * Kept outside the popover, since a delete outlives it.
 */
type RowState = "deleting" | "deleted" | "unmerged";

const rowStatesAtom = Atom.make<ReadonlyMap<string, RowState>>(new Map<string, RowState>()).pipe(
  Atom.keepAlive,
  Atom.withLabel("world:island-branch-row-states"),
);

function setRowState(key: string, state: RowState | null): void {
  const next = new Map(appAtomRegistry.get(rowStatesAtom));
  if (state === null) next.delete(key);
  else next.set(key, state);
  appAtomRegistry.set(rowStatesAtom, next);
}

const isHidden = (state: RowState | undefined) => state === "deleting" || state === "deleted";

interface BranchRow {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  /** The checkout the branch belongs to, where it's deleted from. */
  readonly cwd: string;
  readonly name: string;
  readonly worktreePath: string | null;
  /** Checked out in a project's own folder, which can't be removed from here. */
  readonly inProjectFolder: boolean;
  /** The repository's default branch, which can't be deleted from here. */
  readonly isDefault: boolean;
  readonly lastCommitAt: string | null;
}

/** A worktree whose surfaces open on their own, from its latest thread or a new idle one. */
export interface WorktreeSurfacesTarget {
  readonly environmentId: EnvironmentId;
  /** The project checkout the worktree was listed from. */
  readonly cwd: string;
  readonly path: string;
  readonly branch: string;
  readonly inProjectFolder: boolean;
}

/** The prefix of every row key from a target's repository. */
const repositoryKey = (target: BranchTarget) =>
  `${target.environmentId}\u0000${target.roots.at(-1) ?? target.cwd}\u0000`;

/**
 * An island's local branches, the default one first and the rest most recently committed first.
 * Checkouts of one repository list the same branches, so each appears once.
 */
const islandBranchesAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as ReadonlyArray<BranchTarget>;
    const projectFolders = new Set(targets.flatMap((target) => target.roots));
    const branches = new Map<string, BranchRow>();
    let loading = false;
    for (const target of targets) {
      const result = get(branchRefsAtom(target));
      if (AsyncResult.isInitial(result)) loading = true;
      for (const ref of Option.getOrNull(AsyncResult.value(result))?.refs ?? []) {
        if (ref.isRemote === true) continue;
        const branchKey = `${repositoryKey(target)}${ref.name}`;
        if (branches.has(branchKey)) continue;
        branches.set(branchKey, {
          key: branchKey,
          environmentId: target.environmentId,
          cwd: target.cwd,
          name: ref.name,
          worktreePath: ref.worktreePath,
          inProjectFolder: ref.worktreePath !== null && projectFolders.has(ref.worktreePath),
          isDefault: ref.isDefault,
          lastCommitAt: ref.lastCommitAt ?? null,
        });
      }
    }
    return {
      rows: [...branches.values()].toSorted(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          (b.lastCommitAt ?? "").localeCompare(a.lastCommitAt ?? "") ||
          a.name.localeCompare(b.name),
      ),
      loading,
    };
  }),
);

/**
 * Lists an island's local branches, with when each was last committed to and the worktree it's
 * checked out in, if any, and whether that has uncommitted changes, in a popover at the sign
 * where it was asked for. Stale branches stay out unless the header's switch lets them in; the
 * default branch never goes stale. Each branch has a button that deletes it, worktree and all,
 * after a second click, and asks again if it isn't merged. A deleted branch leaves the list at
 * once, while its worktree is removed, and comes back if that fails.
 */
export function IslandBranchesPopover(props: {
  /** Where on screen the sign was clicked; the popover opens there. */
  readonly point: { readonly x: number; readonly y: number };
  readonly targets: ReadonlyArray<BranchTarget>;
  /** Days without a commit after which a row reads as stale; null for never. */
  readonly staleDays: number | null;
  /** Shows just that worktree's surfaces, its chat collapsed. */
  readonly onOpenSurfaces: (worktree: WorktreeSurfacesTarget) => void;
  /** The hat a worktree's agents wear in the world; null when none work there. */
  readonly hatOf: (worktreePath: string) => number | null;
  readonly onClose: () => void;
}) {
  const { point, targets, staleDays, onClose } = props;
  const { onOpenSurfaces, hatOf } = props;
  const anchor = useMemo(
    () => ({ getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) }),
    [point.x, point.y],
  );
  const { rows: listed, loading } = useAtomValue(islandBranchesAtom(JSON.stringify(targets)));
  const rowStates = useAtomValue(rowStatesAtom);
  // When the rows were last read, which staleness is judged against.
  const [now, setNow] = useState(Date.now);
  const hideStale = useWorldIslandPrefsStore((state) => state.hideStaleBranches);
  const setHideStale = useWorldIslandPrefsStore((state) => state.setHideStaleBranches);
  const isRowStale = (row: BranchRow) =>
    !row.isDefault && staleDays !== null && isStale(row.lastCommitAt, staleDays, now);
  const rows = listed.filter(
    (row) => !isHidden(rowStates.get(row.key)) && !(hideStale && isRowStale(row)),
  );
  const hiddenStale = hideStale ? listed.filter(isRowStale).length : 0;
  // Forgets a deleted branch once its repository's refs no longer list it, so one made again
  // under its name shows.
  useEffect(() => {
    if (loading) return;
    const repositories = targets.map(repositoryKey);
    const present = new Set(listed.map((row) => row.key));
    for (const [key, state] of rowStates) {
      if (state !== "deleted" || present.has(key)) continue;
      if (repositories.some((repository) => key.startsWith(repository))) setRowState(key, null);
    }
  }, [targets, listed, loading, rowStates]);
  // Focus lands on the popup itself, so no row action shows a focus ring on open; Tab still
  // reaches them.
  const popupRef = useRef<HTMLDivElement>(null);
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const [refreshing, setRefreshing] = useState(false);

  const refreshRefs = () => {
    for (const target of targets) appAtomRegistry.refresh(branchRefsAtom(target));
  };
  const pollRefs = useEffectEvent(() => {
    if (document.hidden) return;
    refreshRefs();
    setNow(Date.now());
  });
  useEffect(() => {
    const timer = window.setInterval(pollRefs, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const refreshAll = async () => {
    refreshRefs();
    // Each listed worktree's status, which also fetches its remote and looks its PR up again.
    const checkouts = new Map(
      rows.flatMap(({ environmentId, worktreePath }) =>
        worktreePath === null
          ? []
          : [
              [
                `${environmentId}\u0000${worktreePath}`,
                { environmentId, cwd: worktreePath },
              ] as const,
            ],
      ),
    );
    setRefreshing(true);
    await Promise.all(
      [...checkouts.values()].map(({ environmentId, cwd }) =>
        refreshStatus({ environmentId, input: { cwd } }),
      ),
    ).finally(() => setRefreshing(false));
  };
  // Opening refreshes everything once, after the first read lists the worktrees to refresh.
  const refreshedOnOpen = useRef(false);
  const refreshOnOpen = useEffectEvent(() => void refreshAll());
  useEffect(() => {
    if (loading || refreshedOnOpen.current) return;
    refreshedOnOpen.current = true;
    refreshOnOpen();
  }, [loading]);

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
      >
        <div className="flex items-center justify-between gap-2 pb-4">
          <PopoverTitle>Local Branches</PopoverTitle>
          {staleDays !== null ? (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              Hide stale
              <Switch size="sm" checked={hideStale} onCheckedChange={setHideStale} />
            </label>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="-my-1 shrink-0">
                  <Button
                    type="button"
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label={refreshing ? "Refreshing" : "Refresh"}
                    disabled={refreshing}
                    onClick={() => void refreshAll()}
                  >
                    <RefreshIcon refreshing={refreshing} />
                  </Button>
                </span>
              }
            />
            <TooltipPopup>{refreshing ? "Refreshing…" : "Refresh"}</TooltipPopup>
          </Tooltip>
        </div>
        <Separator className="-mx-4 data-[orientation=horizontal]:w-auto" />
        {rows.length === 0 ? (
          <p className="flex items-center gap-2 pt-3 text-sm text-muted-foreground">
            {loading ? <Spinner size="sm" tone="muted" /> : null}
            {loading
              ? "Loading branches…"
              : hiddenStale > 0
                ? `No recent branches. ${hiddenStale} stale ${hiddenStale === 1 ? "branch is" : "branches are"} hidden.`
                : "No branches."}
          </p>
        ) : (
          <ul className="-mx-2 -mb-2 flex flex-col pt-2">
            {rows.map((row) => (
              <BranchItem
                key={row.key}
                row={row}
                // As the sign counts them: the default branch never goes stale.
                staleDays={row.isDefault ? null : staleDays}
                now={now}
                surfaces={
                  row.worktreePath !== null
                    ? {
                        environmentId: row.environmentId,
                        cwd: row.cwd,
                        path: row.worktreePath,
                        branch: row.name,
                        inProjectFolder: row.inProjectFolder,
                      }
                    : null
                }
                hat={
                  row.worktreePath !== null && !row.inProjectFolder ? hatOf(row.worktreePath) : null
                }
                onOpenSurfaces={(worktree) => {
                  onOpenSurfaces(worktree);
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

type DeleteStep = "idle" | "confirm" | "unmerged";

function BranchItem({
  row,
  staleDays,
  now,
  surfaces,
  hat,
  onOpenSurfaces,
}: {
  readonly row: BranchRow;
  readonly staleDays: number | null;
  readonly now: number;
  /** The hat its worktree's agents wear in the world, null when none work there. */
  readonly hat: number | null;
  /** The branch's worktree, whose surfaces its button opens; null without one. */
  readonly surfaces: WorktreeSurfacesTarget | null;
  readonly onOpenSurfaces: (worktree: WorktreeSurfacesTarget) => void;
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
  const pr = status.data?.pr ?? null;
  const prStatus = prStatusIndicator(pr, status.data?.sourceControlProvider);
  // Without an upstream the server counts ahead of the default branch instead, which isn't
  // the remote, so a branch that was never pushed shows neither arrow.
  const ahead = status.data?.hasUpstream === true ? status.data.aheadCount : 0;
  const behind = status.data?.hasUpstream === true ? status.data.behindCount : 0;
  const workingTree = status.data?.workingTree;
  const allowed = useAtomValue(vcsEnvironment.deleteRef.permissionAtom(row.environmentId));
  const deleteRef = useAtomCommand(vcsEnvironment.deleteRef, { reportFailure: false });
  const [confirming, setConfirming] = useState(false);
  const step: DeleteStep =
    useAtomValue(rowStatesAtom).get(row.key) === "unmerged"
      ? "unmerged"
      : confirming
        ? "confirm"
        : "idle";

  // A confirming click only counts for a moment; after that the button goes back to Delete.
  useEffect(() => {
    if (step === "idle") return;
    const timer = window.setTimeout(() => {
      setConfirming(false);
      if (step === "unmerged") setRowState(row.key, null);
    }, CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [step, row.key]);

  // Runs on after the row hides, so it leaves the outcome in `rowStatesAtom`.
  const remove = async (force: boolean) => {
    setConfirming(false);
    setRowState(row.key, "deleting");
    // The server removes the branch's worktree first, uncommitted changes and all.
    const result = await deleteRef({
      environmentId: row.environmentId,
      input: { cwd: row.cwd, refName: row.name, ...(force ? { force: true } : {}) },
    });
    if (result._tag === "Success") {
      setRowState(row.key, "deleted");
      // The server archives the agents that worked in the removed worktree.
      if (row.worktreePath !== null) refreshArchivedThreadsForEnvironment(row.environmentId);
      return;
    }
    if (isAtomCommandInterrupted(result)) {
      setRowState(row.key, null);
      return;
    }
    const failure = squashAtomCommandFailure(result);
    if (isGitCommandError(failure) && failure.reason === "branch_not_fully_merged") {
      setRowState(row.key, "unmerged");
      return;
    }
    setRowState(row.key, null);
    toastManager.add({
      type: "error",
      title: `Could not delete ${row.name}`,
      description: failure instanceof Error ? failure.message : undefined,
    });
  };

  const blockedReason = row.isDefault
    ? "The default branch can't be deleted"
    : row.inProjectFolder
      ? "Checked out in the project folder"
      : !allowed
        ? "You don't have permission to change this repository"
        : null;

  const stale =
    staleDays !== null && row.lastCommitAt !== null && isStale(row.lastCommitAt, staleDays, now);
  const lastCommit =
    row.lastCommitAt === null ? null : (
      <span
        className={cn("flex shrink-0 items-center gap-1", stale && "text-destructive-foreground")}
        aria-label={stale ? "Last commit, stale" : "Last commit"}
      >
        <GitCommitHorizontalIcon className="size-3.5" />
        {formatRelativeTimeLabel(row.lastCommitAt)}
      </span>
    );

  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex min-w-0 items-center gap-1.5 font-medium text-sm">
          {hat !== null ? (
            <Suspense fallback={null}>
              <HatPortrait hat={hat} className="-my-0.5 size-5" />
            </Suspense>
          ) : null}
          <span className="truncate">{row.name}</span>
        </p>
        <p className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          {row.worktreePath !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex min-w-0 items-center gap-1">
                    <FolderGit2Icon className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {row.inProjectFolder ? "Project folder" : lastSegment(row.worktreePath)}
                    </span>
                  </span>
                }
              />
              <TooltipPopup>{row.worktreePath}</TooltipPopup>
            </Tooltip>
          ) : null}
          {lastCommit !== null && staleDays !== null && stale ? (
            <Tooltip>
              <TooltipTrigger render={lastCommit} />
              <TooltipPopup>
                Stale: no commits in over {staleDays} {staleDays === 1 ? "day" : "days"}
              </TooltipPopup>
            </Tooltip>
          ) : (
            lastCommit
          )}
          {ahead > 0 || behind > 0 ? (
            <span
              className="flex shrink-0 items-center gap-1.5 tabular-nums"
              aria-label={`${ahead} ahead, ${behind} behind the remote`}
            >
              {ahead > 0 ? (
                <span className="flex items-center gap-0.5">
                  <ArrowUpIcon className="size-3.5" />
                  {ahead}
                </span>
              ) : null}
              {behind > 0 ? (
                <span className="flex items-center gap-0.5">
                  <ArrowDownIcon className="size-3.5" />
                  {behind}
                </span>
              ) : null}
            </span>
          ) : null}
          {pr !== null && prStatus !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex shrink-0 items-center gap-1 tabular-nums hover:underline",
                      prStatus.colorClass,
                    )}
                  >
                    <prStatus.Icon className="size-3.5" />#{pr.number}
                  </a>
                }
              />
              <TooltipPopup>
                <PrStatusTooltipContent status={prStatus} />
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </p>
        {dirty && workingTree ? (
          <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <FileDiffIcon className="size-3.5 shrink-0 text-warning-foreground" />
            <span className="truncate">
              {workingTree.files.length} {workingTree.files.length === 1 ? "file" : "files"}
            </span>
            {workingTree.insertions + workingTree.deletions > 0 ? (
              <span className="ml-1 flex shrink-0 gap-1.5 font-medium tabular-nums">
                <span className="text-diff-addition-foreground">+{workingTree.insertions}</span>
                <span className="text-diff-deletion-foreground">−{workingTree.deletions}</span>
              </span>
            ) : null}
          </p>
        ) : status.data !== undefined ? (
          // Said outright, so a clean worktree doesn't read as one whose status hasn't loaded.
          <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground/64">
            <FileDiffIcon className="size-3.5 shrink-0" />
            <span className="truncate">No uncommitted changes</span>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {row.worktreePath !== null && (behind > 0 || ahead > 0) ? (
          <SyncButtons
            environmentId={row.environmentId}
            cwd={row.worktreePath}
            branch={row.name}
            pull={behind > 0}
            push={ahead > 0}
          />
        ) : null}
        {surfaces !== null ? <SurfacesButton onOpen={() => onOpenSurfaces(surfaces)} /> : null}
        <DeleteButton
          hint={row.worktreePath !== null ? "Delete branch and worktree" : "Delete branch"}
          step={step}
          blockedReason={blockedReason}
          onClick={() => {
            if (step === "idle") setConfirming(true);
            else void remove(step === "unmerged");
          }}
        />
      </div>
    </li>
  );
}

function DeleteButton(props: {
  /** What a click does, shown at rest. */
  readonly hint: string;
  readonly step: DeleteStep;
  readonly blockedReason: string | null;
  readonly onClick: () => void;
}) {
  const { step, blockedReason, onClick } = props;
  // At rest the button is just its icon; it spells out what a click does once it's armed.
  const label =
    step === "confirm" ? "Confirm" : step === "unmerged" ? "Not merged — delete anyway" : null;
  const button = (
    <Button
      type="button"
      variant={step === "idle" ? "outline" : "destructive"}
      size={label === null ? "icon-xs" : "xs"}
      className="shrink-0"
      aria-label={label ?? props.hint}
      disabled={blockedReason !== null}
      onClick={onClick}
    >
      <Trash2Icon />
      {label}
    </Button>
  );
  const hint = blockedReason ?? (label === null ? props.hint : null);
  if (hint === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="shrink-0">{button}</span>} />
      <TooltipPopup>{hint}</TooltipPopup>
    </Tooltip>
  );
}

/** Pulls a worktree's branch when it's behind its upstream and pushes it when it's ahead. */
function SyncButtons(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly branch: string;
  readonly pull: boolean;
  readonly push: boolean;
}) {
  const { environmentId, cwd, branch } = props;
  const scope = useMemo(() => ({ environmentId, cwd }), [environmentId, cwd]);
  const pullAction = useVcsPullAction(scope);
  const stackedAction = useGitStackedAction(scope);
  const [running, setRunning] = useState<"pull" | "push" | null>(null);

  const run = async (kind: "pull" | "push") => {
    setRunning(kind);
    const result = await (
      kind === "pull"
        ? pullAction.run()
        : stackedAction.run({ actionId: randomUUID(), action: "push" })
    ).finally(() => setRunning(null));
    if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
    const failure = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: `Could not ${kind} ${branch}`,
      description: failure instanceof Error ? failure.message : undefined,
    });
  };

  return (
    <>
      {props.pull ? (
        <SyncButton
          label="Pull"
          icon={<DownloadIcon />}
          running={running === "pull"}
          disabled={running !== null || !pullAction.isAllowed}
          onClick={() => void run("pull")}
        />
      ) : null}
      {props.push ? (
        <SyncButton
          label="Push"
          icon={<UploadIcon />}
          running={running === "push"}
          disabled={running !== null || !stackedAction.isAllowed}
          onClick={() => void run("push")}
        />
      ) : null}
    </>
  );
}

function SyncButton(props: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly running: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="shrink-0">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              aria-label={props.label}
              disabled={props.disabled}
              onClick={props.onClick}
            >
              {props.running ? <Spinner size="sm" tone="muted" /> : props.icon}
            </Button>
          </span>
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

/** Opens a worktree's surfaces on their own. */
function SurfacesButton(props: { readonly onOpen: () => void }) {
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
              onClick={props.onOpen}
            >
              <PanelRightIcon />
            </Button>
          </span>
        }
      />
      <TooltipPopup>Open surfaces</TooltipPopup>
    </Tooltip>
  );
}

/** The last folder of a path, e.g. a worktree's name. */
function lastSegment(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment.length > 0) ?? path;
}
