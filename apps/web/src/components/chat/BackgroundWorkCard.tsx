import type { PendingBackgroundWorkPresentation } from "@t3tools/client-runtime/state/thread-execution";
import type { ThreadId } from "@t3tools/contracts";
import { SquareIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { InlineButton } from "../ui/button";
import { Spinner } from "../ui/spinner";

/**
 * Background work that outlives the turn, at the end of the timeline: one row per task, and one
 * Stop for all of it. Providers stop background work per thread, not per task. Without
 * `onOpenThread`, subagent rows are plain labels.
 */
export function BackgroundWorkCard({
  presentation,
  canStop,
  stopping,
  onStop,
  onOpenThread,
}: {
  readonly presentation: PendingBackgroundWorkPresentation;
  readonly canStop: boolean;
  readonly stopping: boolean;
  readonly onStop: () => void;
  readonly onOpenThread?: (threadId: ThreadId) => void;
}) {
  return (
    <section
      aria-label={presentation.title}
      data-thread-now-line="true"
      className="mx-auto w-full min-w-0 max-w-(--chat-content-max-width) px-1 pt-4 pb-3"
    >
      <div className="flex w-full max-w-md flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="truncate font-medium text-warning-foreground">Running processes</span>
          <InlineButton
            tone="destructive"
            disabled={!canStop || stopping}
            onClick={onStop}
            aria-label="Stop all background work"
          >
            <SquareIcon aria-hidden className="mr-1 size-3 fill-current" />
            {stopping ? "Stopping..." : "Stop"}
          </InlineButton>
        </div>
        <ul
          className={cn(
            "divide-y divide-warning/24 px-3",
            "rounded-lg border border-warning/24 bg-warning-surface",
            "text-sm text-warning-foreground",
          )}
        >
          {presentation.items.map((item) => {
            const childThreadId = item.childThreadId;
            return (
              <li key={item.taskId} className="flex min-w-0 items-center gap-2 py-2">
                {/* Spinner pauses offscreen and under reduced motion. */}
                <span aria-hidden className="flex shrink-0 opacity-60">
                  <Spinner size="sm" aria-hidden />
                </span>
                {childThreadId === undefined || onOpenThread === undefined ? (
                  <span className="min-w-0 truncate">{item.label}</span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Open subagent ${item.label}`}
                    onClick={() => onOpenThread(childThreadId)}
                    className={cn(
                      "min-w-0 cursor-pointer truncate text-left",
                      "underline-offset-2 hover:underline",
                      "focus-visible:outline-2 focus-visible:outline-ring",
                    )}
                  >
                    {item.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
