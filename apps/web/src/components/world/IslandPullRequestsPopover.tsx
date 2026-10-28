import { GitBranchIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useRef } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { resolvePullRequestState } from "../pullRequest/pullRequestPresentation";
import type {
  EnvironmentPullRequestEntry,
  PullRequestViewers,
} from "../pullRequest/pullRequestList.logic";
import { cn } from "../../lib/utils";
import { Popover, PopoverPopup, PopoverTitle } from "../ui/popover";
import { Separator } from "../ui/separator";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import {
  type IslandPullRequestAgent,
  type IslandPullRequestRow,
  listIslandPullRequests,
  ownIslandPullRequests,
} from "./islandPullRequests";
import { useWorldIslandPrefsStore } from "./worldIslandPrefsStore";

const HatPortrait = lazy(() =>
  import("./scene/CharacterPortrait").then((module) => ({ default: module.HatPortrait })),
);

/**
 * Lists an island's PRs in a popover at the sign where it was asked for: every open one for its
 * repository, and the merged and closed ones its agents worked on. Those an agent works on lead,
 * wearing its hat. The header's switch keeps it to the viewer's own and the island's local
 * branches', besides the agents'.
 */
export function IslandPullRequestsPopover(props: {
  /** Where on screen the sign was clicked; the popover opens there. */
  readonly point: { readonly x: number; readonly y: number };
  readonly entries: ReadonlyArray<EnvironmentPullRequestEntry>;
  /** The signed-in account per host, for telling the viewer's own PRs apart. */
  readonly viewers: PullRequestViewers;
  /** The island's local branches, the default one aside. */
  readonly localBranches: ReadonlySet<string>;
  /** Whether the open PRs are still being read for the first time. */
  readonly loading: boolean;
  readonly agents: ReadonlyArray<IslandPullRequestAgent>;
  /** The hat a worktree's agents wear in the world; null when none work there. */
  readonly hatOf: (worktreePath: string) => number | null;
  readonly onSelect: (row: IslandPullRequestRow) => void;
  readonly onClose: () => void;
}) {
  const { point, entries, viewers, localBranches, loading, agents, hatOf, onSelect, onClose } =
    props;
  const ownOnly = useWorldIslandPrefsStore((state) => state.ownPullRequestsOnly);
  const setOwnOnly = useWorldIslandPrefsStore((state) => state.setOwnPullRequestsOnly);
  const anchor = useMemo(
    () => ({ getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) }),
    [point.x, point.y],
  );
  const all = useMemo(() => listIslandPullRequests(entries, agents), [entries, agents]);
  const own = useMemo(
    () => listIslandPullRequests(ownIslandPullRequests(entries, viewers, localBranches), agents),
    [entries, viewers, localBranches, agents],
  );
  const rows = ownOnly ? own : all;
  const hidden = ownOnly ? all.length - own.length : 0;
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
        align="start"
        sideOffset={8}
        width="lg"
      >
        <div className="flex items-center justify-between gap-2 pb-4">
          <PopoverTitle>Pull Requests</PopoverTitle>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            Mine only
            <Switch size="sm" checked={ownOnly} onCheckedChange={setOwnOnly} />
          </label>
        </div>
        <Separator className="-mx-4 data-[orientation=horizontal]:w-auto" />
        {rows.length === 0 ? (
          <p className="flex items-center gap-2 pt-3 text-sm text-muted-foreground">
            {loading ? <Spinner size="sm" tone="muted" /> : null}
            {loading
              ? "Loading pull requests…"
              : hidden > 0
                ? `None of yours. ${hidden} other ${hidden === 1 ? "pull request is" : "pull requests are"} hidden.`
                : "No pull requests."}
          </p>
        ) : (
          // The list scrolls under the title, keeping the popover within 600px.
          <ul className="-mx-2 -mb-2 flex max-h-[520px] flex-col overflow-y-auto pt-2">
            {rows.map((row) => (
              <PullRequestItem
                key={row.key}
                row={row}
                hat={row.agent?.worktreePath ? hatOf(row.agent.worktreePath) : null}
                onSelect={() => {
                  onSelect(row);
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

function PullRequestItem(props: {
  readonly row: IslandPullRequestRow;
  readonly hat: number | null;
  readonly onSelect: () => void;
}) {
  const { row, hat } = props;
  const state = resolvePullRequestState(row);
  return (
    <li>
      <button
        type="button"
        className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-accent focus-visible:bg-accent"
        aria-label={`${state.label} #${row.number}: ${row.title}`}
        onClick={props.onSelect}
      >
        <state.Icon className={cn("mt-0.5 size-4 shrink-0", state.toneClassName)} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium text-sm">{row.title}</span>
          <span className="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0 tabular-nums">#{row.number}</span>
            <span className="flex min-w-0 items-center gap-1">
              <GitBranchIcon className="size-3.5 shrink-0" />
              <span className="truncate">{row.headBranch}</span>
            </span>
            {row.author !== null ? <span className="shrink-0">{row.author}</span> : null}
            {row.updatedAt !== null ? (
              <span className="shrink-0">{formatRelativeTimeLabel(row.updatedAt)}</span>
            ) : null}
          </span>
        </span>
        {hat !== null ? (
          <Suspense fallback={null}>
            <HatPortrait hat={hat} className="size-5 shrink-0" />
          </Suspense>
        ) : null}
      </button>
    </li>
  );
}
