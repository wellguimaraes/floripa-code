import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { MessageId, RunId, ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useDiffPanelStore } from "../../diffPanelStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useTimelineEntries } from "../../hooks/useTimelineEntries";
import { useTurnDiffSummaries } from "../../hooks/useTurnDiffSummaries";
import { useRightPanelStore } from "../../rightPanelStore";
import {
  deriveThreadRunState,
  deriveTimelineActivity,
  type TimelineEntry,
} from "../../session-logic";
import { useThreadProjection, useThreadVisibleTurnItems } from "../../state/entities";
import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { expandedImageKey, type ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { InlineTimelineRows, type UserMessageChipState } from "../chat/MessagesTimeline";

const NO_RUNS: ReadonlyArray<never> = [];
const NO_ENTRIES: ReadonlyArray<TimelineEntry> = [];
// Exchanges shown above yours on open, and how many more each scroll to the top brings in.
const FIRST_EARLIER_EXCHANGES = 2;
const MORE_EARLIER_EXCHANGES = 3;
// How close to the top a scroll has to come to bring in more.
const LOAD_MORE_WITHIN_PX = 48;
const NO_RUN_STATE = {
  latestRun: null,
  activityRun: null,
  runtime: null,
  runlessWorkStartedAt: null,
};

/**
 * Your last exchange as the chat shows it: the agent's work, its words, and how
 * long it has been at it. Your message itself is rendered by the bubble and
 * placed between the turn and the exchanges before it, which load in further
 * as you scroll up.
 */
export function LatestTurn(props: {
  readonly threadRef: ScopedThreadRef;
  /** Your last message, pinned above; the turn starts there. */
  readonly sentMessageId: MessageId | null;
  /** The agent waits on an approval or an answer from you. */
  readonly awaitingUser: boolean;
  readonly cwd: string | null;
  readonly workspaceRoot: string | undefined;
  readonly resolvedTheme: "light" | "dark";
  readonly skills: UserMessageChipState["skills"];
  readonly providers: ReadonlyArray<ServerProvider>;
  /** Opens the full chat, where links into other threads and diffs lead on from. */
  readonly onOpenFullChat: () => void;
  /** Your last message, as the bubble pins it. */
  readonly pinned: ReactNode;
  /** What scrolls the exchange: reaching its top brings in earlier exchanges. */
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { threadRef, sentMessageId, onOpenFullChat, scrollRef } = props;
  const projection = useThreadProjection(threadRef)?.projection ?? null;
  const visibleTurnItems = useThreadVisibleTurnItems(threadRef);
  const timestampFormat = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.timestampFormat,
  );
  const { turnDiffSummaries } = useTurnDiffSummaries(projection);

  const allEntries = useTimelineEntries({
    threadKey: scopedThreadKey(threadRef),
    projection,
    visibleTurnItems,
  });
  const [earlierExchanges, setEarlierExchanges] = useState(FIRST_EARLIER_EXCHANGES);
  // A message still queued has no entry yet: the turn running now, from the message before, shows.
  const { earlierEntries, timelineEntries, hasMore } = useMemo(() => {
    const isUserMessage = (entry: TimelineEntry) =>
      entry.kind === "message" && entry.message.role === "user";
    const sentIndex = allEntries.findLastIndex(
      (entry) => entry.kind === "message" && entry.message.id === sentMessageId,
    );
    const start = sentIndex !== -1 ? sentIndex : allEntries.findLastIndex(isUserMessage);
    if (start <= 0)
      return { earlierEntries: NO_ENTRIES, timelineEntries: allEntries, hasMore: false };
    let from = start;
    let found = 0;
    for (let index = start - 1; index >= 0 && found < earlierExchanges; index--) {
      const entry = allEntries[index];
      if (entry !== undefined && isUserMessage(entry)) {
        from = index;
        found++;
      }
    }
    // Fewer exchanges than asked for: whatever came before the first one shows too.
    if (found < earlierExchanges) from = 0;
    return {
      earlierEntries: allEntries.slice(from, start),
      timelineEntries: allEntries.slice(start),
      hasMore: from > 0,
    };
  }, [allEntries, sentMessageId, earlierExchanges]);

  // How far from the bottom the view sat when more was asked for: it stays there as it loads above.
  const restoreFromBottom = useRef<number | null>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null || !hasMore) return;
    const loadMoreNearTop = () => {
      const overflows = element.scrollHeight > element.clientHeight;
      if (overflows && element.scrollTop > LOAD_MORE_WITHIN_PX) return;
      restoreFromBottom.current = element.scrollHeight - element.scrollTop;
      setEarlierExchanges((count) => count + MORE_EARLIER_EXCHANGES);
    };
    // Nothing to scroll yet means nothing would ever bring in more: fill until it scrolls,
    // checking again after each load.
    loadMoreNearTop();
    element.addEventListener("scroll", loadMoreNearTop, { passive: true });
    return () => element.removeEventListener("scroll", loadMoreNearTop);
  }, [scrollRef, hasMore, earlierExchanges]);
  // Once the exchanges just loaded are laid out, before they paint.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const fromBottom = restoreFromBottom.current;
    if (element === null || fromBottom === null) return;
    restoreFromBottom.current = null;
    element.scrollTop = element.scrollHeight - fromBottom;
  }, [scrollRef, earlierExchanges]);

  const runState = useMemo(
    () => (projection === null ? NO_RUN_STATE : deriveThreadRunState(projection)),
    [projection],
  );
  const activity = deriveTimelineActivity(runState);

  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null);
  // Read at call time, so the rows' shared callbacks stay put while the bubble re-renders.
  const openFullChatRef = useRef(onOpenFullChat);
  openFullChatRef.current = onOpenFullChat;
  const openFullChat = useCallback(() => openFullChatRef.current(), []);
  const openTurnDiff = useCallback(
    (runId: RunId, filePath?: string) => {
      useDiffPanelStore.getState().selectTurn(threadRef, runId, filePath);
      useRightPanelStore.getState().open(threadRef, "diff");
      openFullChatRef.current();
    },
    [threadRef],
  );

  const sharedRowProps = {
    threadRef,
    runs: projection?.runs ?? NO_RUNS,
    turnDiffSummaries,
    providerStatuses: props.providers,
    markdownCwd: props.cwd ?? undefined,
    workspaceRoot: props.workspaceRoot,
    resolvedTheme: props.resolvedTheme,
    timestampFormat,
    skills: props.skills,
    onOpenTurnDiff: openTurnDiff,
    onOpenThread: openFullChat,
    onImageExpand: setExpandedImage,
  };
  return (
    <>
      {earlierEntries.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2">
          <InlineTimelineRows
            {...sharedRowProps}
            timelineEntries={earlierEntries}
            hiddenMessageId={null}
            isWorking={false}
            runlessWorkActive={false}
            activeTurnInProgress={false}
            activeTurnStartedAt={null}
            awaitingUser={false}
            latestRun={null}
            runningRunId={null}
          />
        </div>
      ) : null}
      {props.pinned}
      {timelineEntries.length > 0 || activity.isWorking ? (
        <InlineTimelineRows
          {...sharedRowProps}
          timelineEntries={timelineEntries}
          hiddenMessageId={sentMessageId}
          {...activity}
          awaitingUser={props.awaitingUser}
          latestRun={runState.activityRun}
        />
      ) : null}
      {expandedImage !== null ? (
        <ExpandedImageDialog
          key={expandedImageKey(expandedImage)}
          preview={expandedImage}
          onClose={() => setExpandedImage(null)}
        />
      ) : null}
    </>
  );
}
