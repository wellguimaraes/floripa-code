import { useAtomValue } from "@effect/atom-react";
import { parseThreadKey, threadKey } from "@t3tools/client-runtime/state/entities";
import type { OrchestrationV2ConversationMessage, ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../../state/threads";

export interface SentMessage {
  readonly id: string;
  readonly text: string;
  readonly attachmentCount: number;
}

/** The last message you wrote to the thread, not one an agent or the system posted for you. */
function lastSentMessage(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): SentMessage | null {
  const message = messages.findLast(
    (candidate) => candidate.role === "user" && candidate.createdBy === "user",
  );
  if (message === undefined) return null;
  return { id: message.id, text: message.text, attachmentCount: message.attachments.length };
}

const lastSentAtomFamily = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  let previous: SentMessage | null = null;
  // Only a different message re-renders: streaming replies leave it alone.
  return Atom.make((get): SentMessage | null => {
    const thread = get(environmentThreadDetails.threadAtom(ref));
    const next = thread === null ? null : lastSentMessage(thread.projection.messages);
    if (
      next?.id === previous?.id &&
      next?.text === previous?.text &&
      next?.attachmentCount === previous?.attachmentCount
    ) {
      return previous;
    }
    previous = next;
    return next;
  }).pipe(Atom.withLabel(`world-last-sent-message:${key}`));
});

/** Loads the thread while in use; null until it has, or if you never wrote to it. */
export function useLastSentMessage(ref: ScopedThreadRef): SentMessage | null {
  return useAtomValue(lastSentAtomFamily(threadKey(ref)));
}
