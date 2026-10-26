import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { useMemo, useRef } from "react";

import {
  deriveTimelineEntriesFromVisibleTurnItemsWithState,
  type TimelineEntriesInput,
  type TimelineEntriesProjection,
} from "../session-logic";
import type { ChatMessage } from "../types";

const NO_MESSAGES: ReadonlyArray<ChatMessage> = [];

/**
 * A thread's timeline entries. Unchanged entries carry over from the last
 * derivation for the same thread, so history rows stay mounted while the
 * agent streams.
 */
export function useTimelineEntries(input: {
  readonly threadKey: string | null;
  readonly projection: OrchestrationV2ThreadProjection | null;
  readonly visibleTurnItems: TimelineEntriesInput["visibleTurnItems"];
  readonly optimisticMessages?: ReadonlyArray<ChatMessage>;
  readonly anchoredMessages?: ReadonlyArray<ChatMessage>;
  readonly attachmentUrlById?: ReadonlyMap<string, string>;
}) {
  const {
    threadKey,
    projection,
    visibleTurnItems,
    optimisticMessages = NO_MESSAGES,
    anchoredMessages,
    attachmentUrlById,
  } = input;
  const previousRef = useRef<{
    readonly threadKey: string | null;
    readonly projection: TimelineEntriesProjection;
  } | null>(null);
  return useMemo(() => {
    const previous = previousRef.current;
    const next = deriveTimelineEntriesFromVisibleTurnItemsWithState(
      {
        visibleTurnItems,
        optimisticMessages,
        ...(anchoredMessages === undefined ? {} : { anchoredMessages }),
        ...(attachmentUrlById === undefined ? {} : { attachmentUrlById }),
        ...(projection === null
          ? {}
          : { attempts: projection.attempts, nodes: projection.nodes, plans: projection.plans }),
      },
      previous?.threadKey === threadKey ? previous.projection : null,
    );
    previousRef.current = { threadKey, projection: next };
    return next.entries;
  }, [
    threadKey,
    anchoredMessages,
    optimisticMessages,
    visibleTurnItems,
    projection,
    attachmentUrlById,
  ]);
}
