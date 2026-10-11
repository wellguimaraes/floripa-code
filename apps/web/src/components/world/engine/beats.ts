import type { CharacterFacts } from "./facts";

interface BeatEntry {
  /** The raw beat last seen, and when it last changed. */
  readonly raw: number;
  readonly changedAt: number;
  /** The paced beat handed out, and when it last advanced. */
  readonly beat: number;
  readonly at: number;
}

export interface BeatGate {
  readonly byKey: ReadonlyMap<string, BeatEntry>;
}

export const EMPTY_BEAT_GATE: BeatGate = { byKey: new Map() };

/**
 * Paces beats and spots quiet threads. A character's beat advances by one
 * when its raw beat changed and at least `dwellMs` passed since the last
 * advance; work that lands sooner waits for the next update after the dwell.
 * A thread whose raw beat has not changed for `quietMs` is `quiet`.
 */
export function gateBeats(input: {
  readonly facts: ReadonlyArray<CharacterFacts>;
  readonly previous: BeatGate;
  readonly now: number;
  readonly dwellMs: number;
  readonly quietMs: number;
}): { readonly facts: CharacterFacts[]; readonly gate: BeatGate } {
  const { now } = input;
  const byKey = new Map<string, BeatEntry>();
  const facts = input.facts.map((fact) => {
    const before = input.previous.byKey.get(fact.key);
    let entry: BeatEntry = before ?? { raw: fact.beat, changedAt: now, beat: 0, at: now };
    if (before !== undefined && fact.beat !== before.raw) {
      entry =
        now - before.at >= input.dwellMs
          ? { raw: fact.beat, changedAt: now, beat: before.beat + 1, at: now }
          : { ...before, changedAt: now };
    }
    byKey.set(fact.key, entry);
    return { ...fact, beat: entry.beat, quiet: now - entry.changedAt >= input.quietMs };
  });
  return { facts, gate: { byKey } };
}
