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
import { ArchiveIcon, ArchiveRestoreIcon, type LucideIcon, MessageSquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useThreadActions } from "../../hooks/useThreadActions";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { signTextColor } from "./scene/Sign";

/**
 * Lists an island's archived agents, most recently active first, each with a
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

export function RestoreArchivedDialog(props: {
  readonly title: string;
  /** The island sign's colour; the header's project chip wears it, as in the chat header. */
  readonly color: string;
  /** The projects that share the island. */
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  readonly onClose: () => void;
}) {
  const { title, color, projectRefs, onClose } = props;
  const chipStyle = useMemo(
    () => ({ backgroundColor: color, color: signTextColor(color) }),
    [color],
  );
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
        (a, b) => lastMessageAt(b).localeCompare(lastMessageAt(a)) || b.id.localeCompare(a.id),
      );
  }, [snapshots, projectRefs]);

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
      <DialogPopup className="max-h-[min(500px,calc(100dvh-2rem))] max-w-md [--glass-opacity:100%]">
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
          <DialogTitle>Restore archived agents</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          {threads.length === 0 ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              {isLoading ? <Spinner size="sm" tone="muted" /> : null}
              {isLoading
                ? "Loading archived agents…"
                : (error ?? "No archived agents on this island.")}
            </p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {threads.map((thread) => {
                const key = `${thread.environmentId}:${thread.id}`;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{thread.title || "Untitled thread"}</p>
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
