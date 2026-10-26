import { scopedProjectKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentThreadShell,
  presentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import type { OrchestrationArchivedThreadSearchIndex } from "@t3tools/contracts";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  type LucideIcon,
  MessageSquareIcon,
  SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { useArchivedThreadSearch } from "../../state/queries";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import type { ProjectFaviconProject } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { signTextColor } from "./scene/Sign";
import { WorldProjectPill } from "./WorldProjectPill";

/**
 * Lists an island's archived agents, most recently archived first, each with a
 * button that brings it back. Restored agents leave the list; the dialog
 * stays open so several can come back in one go.
 */
/** When the agent's conversation last moved: the later of its last message and its last finished run. */
function lastMessageAt(thread: EnvironmentThreadShell): string {
  const candidates = [thread.latestUserMessageAt, thread.latestRun?.completedAt].filter(
    (value): value is string => value != null,
  );
  return candidates.toSorted().at(-1) ?? thread.createdAt;
}

/** A relative time behind an icon that says what happened then; hovering spells it out. */
function TimeLabel(props: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly at: string;
}) {
  const { icon: Icon, label, at } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex items-center gap-1" aria-label={label}>
            <Icon className="size-3" />
            {formatRelativeTimeLabel(at)}
          </span>
        }
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** What semantic search is still doing, or null once it has nothing to add. */
function indexStatusLabel(index: OrchestrationArchivedThreadSearchIndex | null): string | null {
  if (index === null) return null;
  switch (index.status) {
    case "preparing":
      return index.indexed < index.total ? "Preparing search by meaning…" : null;
    case "indexing":
      return `Reading archived agents for search by meaning… ${index.indexed} of ${index.total}`;
    case "unavailable":
      return "Search by meaning is unavailable; showing word matches.";
    case "ready":
      return null;
  }
}

export function RestoreArchivedDialog(props: {
  readonly title: string;
  /** The project whose icon leads the header's pill. */
  readonly project: ProjectFaviconProject | null;
  /** The island sign's colour; the header's project pill wears it. */
  readonly color: string;
  /** The projects that share the island. */
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  readonly onClose: () => void;
}) {
  const { title, project, color, projectRefs, onClose } = props;
  const plate = useMemo(() => ({ background: color, text: signTextColor(color) }), [color]);
  const environmentIds = useMemo(
    () => [...new Set(projectRefs.map((ref) => ref.environmentId))] as EnvironmentId[],
    [projectRefs],
  );
  const { snapshots, error, isLoading } = useArchivedThreadSnapshots(environmentIds);
  const threads = useMemo(() => {
    const keys = new Set(projectRefs.map(scopedProjectKey));
    return snapshots
      .flatMap(({ environmentId, snapshot }) =>
        snapshot.threads.map((thread) => presentThreadShell(environmentId, thread)),
      )
      .filter((thread) =>
        keys.has(
          scopedProjectKey({ environmentId: thread.environmentId, projectId: thread.projectId }),
        ),
      )
      .toSorted(
        (a, b) =>
          (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") ||
          lastMessageAt(b).localeCompare(lastMessageAt(a)) ||
          b.id.localeCompare(a.id),
      );
  }, [snapshots, projectRefs]);

  const [query, setQuery] = useState("");
  const search = useArchivedThreadSearch(projectRefs, query);
  // Server matches lead in their ranked order; a title filter answers
  // instantly and covers environments that cannot search archives.
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length === 0) return threads.map((thread) => ({ thread, snippet: null }));
    const byKey = new Map(
      threads.map((thread) => [`${thread.environmentId}:${thread.id}`, thread]),
    );
    const seen = new Set<string>();
    const ranked: Array<{ thread: (typeof threads)[number]; snippet: string | null }> = [];
    for (const match of search.matches) {
      const key = `${match.environmentId}:${match.threadId}`;
      const thread = byKey.get(key);
      if (thread === undefined || seen.has(key)) continue;
      seen.add(key);
      ranked.push({ thread, snippet: match.snippet || null });
    }
    for (const thread of threads) {
      const key = `${thread.environmentId}:${thread.id}`;
      if (seen.has(key) || !thread.title.toLocaleLowerCase().includes(needle)) continue;
      ranked.push({ thread, snippet: null });
    }
    return ranked;
  }, [threads, query, search.matches]);
  const searching = query.trim().length >= 2;
  const statusLabel = searching ? indexStatusLabel(search.index) : null;
  const isSearchLoading =
    searching &&
    (search.isPending ||
      search.index?.status === "preparing" ||
      search.index?.status === "indexing");

  const { unarchiveThread } = useThreadActions();
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const restore = async (thread: (typeof threads)[number]) => {
    const key = `${thread.environmentId}:${thread.id}`;
    setRestoring((current) => new Set(current).add(key));
    const result = await unarchiveThread(scopeThreadRef(thread.environmentId, thread.id));
    setRestoring((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not restore the agent",
        description: failure instanceof Error ? failure.message : undefined,
      });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* A fixed height keeps the search box still while results come and go. */}
      <DialogPopup className="h-[min(500px,calc(100dvh-2rem))] max-w-md">
        <DialogHeader>
          <WorldProjectPill size="sm" project={project} name={title} plate={plate} />
          <DialogTitle>Restore archived agents</DialogTitle>
          {threads.length > 0 ? (
            <InputGroup className="mt-2">
              <InputGroupAddon>
                <SearchIcon aria-hidden className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search archived agents"
                autoFocus
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search by words or meaning"
                size="sm"
                type="search"
                value={query}
              />
              {isSearchLoading ? (
                <InputGroupAddon align="inline-end">
                  <Spinner size="sm" tone="muted" />
                </InputGroupAddon>
              ) : null}
            </InputGroup>
          ) : null}
          {statusLabel !== null ? (
            <p className="text-xs text-muted-foreground">{statusLabel}</p>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          {threads.length === 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              {isLoading ? <Spinner size="sm" tone="muted" /> : null}
              {isLoading
                ? "Loading archived agents…"
                : (error ?? "No archived agents on this island.")}
            </p>
          ) : visible.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              {search.isPending ? "Searching…" : "No archived agents match."}
            </p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {visible.map(({ thread, snippet }) => {
                const key = `${thread.environmentId}:${thread.id}`;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{thread.title || "Untitled thread"}</p>
                      {snippet !== null ? (
                        <p className="truncate text-xs text-muted-foreground">{snippet}</p>
                      ) : null}
                      <p className="flex items-center gap-3 text-xs text-muted-foreground">
                        <TimeLabel
                          icon={MessageSquareIcon}
                          label="Last message"
                          at={lastMessageAt(thread)}
                        />
                        {thread.archivedAt ? (
                          <TimeLabel icon={ArchiveIcon} label="Archived" at={thread.archivedAt} />
                        ) : null}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="shrink-0"
                      disabled={restoring.has(key)}
                      onClick={() => void restore(thread)}
                    >
                      <ArchiveRestoreIcon className="size-3.5" />
                      {restoring.has(key) ? "Restoring…" : "Restore"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
