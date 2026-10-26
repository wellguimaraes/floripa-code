import { useAtomValue } from "@effect/atom-react";
import { parseThreadKey, threadKey } from "@t3tools/client-runtime/state/entities";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../../state/threads";
import { lastExchange, type LastExchange } from "./lastExchange";

const NO_EXCHANGE: LastExchange = { sent: null };

function sameExchange(a: LastExchange, b: LastExchange): boolean {
  return (
    a.sent?.id === b.sent?.id &&
    a.sent?.text === b.sent?.text &&
    a.sent?.attachments.length === b.sent?.attachments.length &&
    a.sent?.queued?.runId === b.sent?.queued?.runId &&
    a.sent?.queued?.steerTargetRunId === b.sent?.queued?.steerTargetRunId
  );
}

const lastExchangeAtomFamily = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  let previous = NO_EXCHANGE;
  // Only a different message re-renders: streaming replies leave it alone.
  return Atom.make((get): LastExchange => {
    const thread = get(environmentThreadDetails.threadAtom(ref));
    const next = thread === null ? NO_EXCHANGE : lastExchange(thread.projection);
    if (sameExchange(next, previous)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`world-last-exchange:${key}`));
});

/** Loads the thread while in use; empty until it has. */
export function useLastExchange(ref: ScopedThreadRef): LastExchange {
  return useAtomValue(lastExchangeAtomFamily(threadKey(ref)));
}
