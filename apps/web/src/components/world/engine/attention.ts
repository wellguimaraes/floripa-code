/**
 * Which islands ripple. A character that starts matching a ripple rule (it
 * needs you, or finished something unread) makes its island ripple until you
 * interact with that island, even if the reason goes away on its own; a reason
 * that clears and comes back later counts as new.
 */
export interface AttentionState {
  /** Reasons present on the last update, so an ongoing one is not new again. */
  readonly seen: ReadonlySet<string>;
  /** Unacknowledged reasons, by island. */
  readonly pending: ReadonlyMap<string, ReadonlySet<string>>;
}

export const EMPTY_ATTENTION: AttentionState = { seen: new Set(), pending: new Map() };

export function noticeAttention(
  state: AttentionState,
  islands: ReadonlyArray<{ readonly key: string; readonly attention: ReadonlyArray<string> }>,
): AttentionState {
  const seen = new Set<string>();
  const pending = new Map(state.pending);
  for (const island of islands) {
    for (const reason of island.attention) {
      seen.add(reason);
      if (state.seen.has(reason)) continue;
      pending.set(island.key, new Set([...(pending.get(island.key) ?? []), reason]));
    }
  }
  return { seen, pending };
}

/** The user interacted with the island: its water calms down. */
export function acknowledgeIsland(state: AttentionState, islandKey: string): AttentionState {
  if (!state.pending.has(islandKey)) return state;
  const pending = new Map(state.pending);
  pending.delete(islandKey);
  return { seen: state.seen, pending };
}

export function isRippling(state: AttentionState, islandKey: string): boolean {
  return (state.pending.get(islandKey)?.size ?? 0) > 0;
}
