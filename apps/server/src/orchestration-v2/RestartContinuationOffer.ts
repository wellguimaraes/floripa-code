import type {
  RestartContinuationOffer as RestartContinuationOfferPayload,
  RestartContinuationOfferResolveInput,
  RestartContinuationOfferResolveResult,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ServerSettings from "../serverSettings.ts";
import { continueRestartedRun } from "./RestartContinuation.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

interface OfferedThread {
  readonly threadId: ThreadId;
  readonly sourceRunId: RunId;
  readonly title: string;
}

export interface RestartContinuationOfferShape {
  /** Holds a thread the restart interrupted until the user answers. */
  readonly add: (thread: OfferedThread) => Effect.Effect<void>;
  /** The current offer, then every change. Clients ask while it is non-empty. */
  readonly offer: Stream.Stream<RestartContinuationOfferPayload>;
  /** Resumes or dismisses every offered thread. Later answers find nothing left. */
  readonly resolve: (
    input: RestartContinuationOfferResolveInput,
  ) => Effect.Effect<RestartContinuationOfferResolveResult>;
}

/**
 * Threads a restart interrupted while continuation was off. Kept in memory: the
 * offer only describes this server process's restart, and a later restart
 * leaves those runs already cancelled, so there is nothing left to resume.
 */
export class RestartContinuationOffer extends Context.Service<
  RestartContinuationOffer,
  RestartContinuationOfferShape
>()("t3/orchestration-v2/RestartContinuationOffer") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const offered = yield* SubscriptionRef.make<ReadonlyArray<OfferedThread>>([]);

  const add = (thread: OfferedThread) =>
    SubscriptionRef.update(offered, (current) =>
      current.some((entry) => entry.threadId === thread.threadId) ? current : [...current, thread],
    );

  const resolve = Effect.fn("RestartContinuationOffer.resolve")(function* (
    input: RestartContinuationOfferResolveInput,
  ) {
    const taken = yield* SubscriptionRef.getAndSet(offered, []);
    if (!input.resume) return { resumedThreadCount: 0 };
    let resumedThreadCount = 0;
    for (const thread of taken) {
      // Re-checked against current state: a message sent since the restart wins.
      const outcome = yield* continueRestartedRun({
        threadId: thread.threadId,
        sourceRunId: thread.sourceRunId,
        consented: true,
      }).pipe(
        Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
        Effect.provideService(ServerSettings.ServerSettingsService, settings),
        Effect.catchCause((cause) =>
          Effect.logWarning("Failed to resume a thread after restart", {
            threadId: thread.threadId,
            cause,
          }).pipe(Effect.as({ type: "skipped" } as const)),
        ),
      );
      if (outcome.type === "continued") resumedThreadCount += 1;
    }
    return { resumedThreadCount };
  });

  return RestartContinuationOffer.of({
    add,
    offer: SubscriptionRef.changes(offered).pipe(
      Stream.map((current) => ({
        threads: current.map(({ threadId, title }) => ({ threadId, title })),
      })),
    ),
    resolve,
  });
});

export const layer = Layer.effect(RestartContinuationOffer, make);
