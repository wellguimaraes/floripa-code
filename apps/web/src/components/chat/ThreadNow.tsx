import type { ReactNode } from "react";

/** A line of thread state for the end of the timeline. */
export interface ThreadNowItem {
  readonly id: string;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

/** One line of thread state at the end of the timeline: icon, title, detail, then actions. */
function ThreadNowLine({
  item,
  announce = false,
}: {
  readonly item: ThreadNowItem;
  /** Announces the line when it appears; only for something that needs the user. */
  readonly announce?: boolean;
}) {
  return (
    <div
      role={announce ? "alert" : undefined}
      data-thread-now-line="true"
      className="mx-auto flex w-full min-w-0 max-w-(--chat-content-max-width) items-center gap-1.5 px-1 pb-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0"
    >
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        {item.icon}
      </span>
      {/* Title and detail read as one line that gives way before the actions, so Stop stays
          reachable. */}
      <span className="min-w-0 truncate">
        {item.title}
        {item.description ? (
          <>
            {" "}
            <span aria-hidden>·</span> {item.description}
          </>
        ) : null}
      </span>
      {item.actions ? (
        <>
          <span aria-hidden>·</span>
          <span className="flex shrink-0 items-center gap-1.5">{item.actions}</span>
        </>
      ) : null}
    </div>
  );
}

/**
 * What the thread is doing now, at the end of the timeline: what needs you elsewhere, such as a
 * subagent's question, then background work, then the goal.
 */
export function ThreadNow({
  attention,
  work,
  goal,
}: {
  readonly attention: ThreadNowItem | null;
  readonly work: ThreadNowItem | null;
  readonly goal: ThreadNowItem | null;
}): ReactNode {
  return (
    <>
      {attention ? <ThreadNowLine item={attention} announce /> : null}
      {work ? <ThreadNowLine item={work} /> : null}
      {goal ? <ThreadNowLine item={goal} /> : null}
    </>
  );
}
