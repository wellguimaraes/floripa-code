import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { MessageId, RunId, ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import { useCallback, useMemo, useRef, useState } from "react";

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
const NO_RUN_STATE = {
  latestRun: null,
  activityRun: null,
  runtime: null,
  runlessWorkStartedAt: null,
};

/**
 * Everything after your last message, as the chat shows it: the agent's work,
 * its words, and how long it has been at it. Your message itself is pinned
 * above by the bubble, so it is left out here.
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
}) {
  const { threadRef, sentMessageId, onOpenFullChat } = props;
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
  // A message still queued has no entry yet: the turn running now, from the message before, shows.
  const timelineEntries = useMemo(() => {
    const isUserMessage = (entry: TimelineEntry) =>
      entry.kind === "message" && entry.message.role === "user";
    const sentIndex = allEntries.findLastIndex(
      (entry) => entry.kind === "message" && entry.message.id === sentMessageId,
    );
    const start = sentIndex !== -1 ? sentIndex : allEntries.findLastIndex(isUserMessage);
    return start <= 0 ? allEntries : allEntries.slice(start);
  }, [allEntries, sentMessageId]);

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

  if (timelineEntries.length === 0 && !activity.isWorking) return null;
  return (
    <>
      <InlineTimelineRows
        threadRef={threadRef}
        timelineEntries={timelineEntries}
        hiddenMessageId={sentMessageId}
        {...activity}
        awaitingUser={props.awaitingUser}
        latestRun={runState.activityRun}
        runs={projection?.runs ?? NO_RUNS}
        turnDiffSummaries={turnDiffSummaries}
        providerStatuses={props.providers}
        markdownCwd={props.cwd ?? undefined}
        workspaceRoot={props.workspaceRoot}
        resolvedTheme={props.resolvedTheme}
        timestampFormat={timestampFormat}
        skills={props.skills}
        onOpenTurnDiff={openTurnDiff}
        onOpenThread={openFullChat}
        onImageExpand={setExpandedImage}
      />
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
