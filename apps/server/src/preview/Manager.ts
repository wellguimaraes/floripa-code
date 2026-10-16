/**
 * In-memory PreviewManager implementation.
 *
 * Sessions are keyed by `tabId` (process-unique) and belong to the opening
 * thread's checkout (`scopeKey`), so every thread in one worktree lists and
 * drives the same tabs. A tab whose thread could not be resolved belongs to
 * that thread alone. `open` always creates a new tab — tab lifecycle is owned
 * by the renderer.
 *
 * Events are published via Effect's `PubSub`, so subscriber failures are
 * isolated from the publishing call (a closed WS subscriber queue cannot
 * fail an in-progress `navigate()`).
 */
import {
  type PreviewCloseInput,
  type PreviewEvent,
  type PreviewError,
  PreviewInvalidUrlError,
  type PreviewListInput,
  type PreviewListResult,
  type PreviewNavigateInput,
  type PreviewOpenInput,
  type PreviewRefreshInput,
  type PreviewReportStatusInput,
  type PreviewResizeInput,
  type PreviewAdjustInput,
  FILL_PREVIEW_VIEWPORT,
  PreviewSessionLookupError,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import {
  isPreviewUrlNormalizationError,
  newPreviewTabId,
  normalizePreviewUrl,
} from "@t3tools/shared/preview";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import { PreviewControlRequiredError } from "@t3tools/contracts";

import { worktreeScopeKey } from "@t3tools/shared/worktreeScope";

import * as WorktreeScopes from "../workspace/WorktreeScopes.ts";

const CLIENT_SCOPE_HINT_LIMIT = 256;

export class PreviewManager extends Context.Service<
  PreviewManager,
  {
    readonly open: (
      input: PreviewOpenInput & {
        readonly automationOwner?: string;
        /** The scope to open in, such as a popup's opener tab's; resolved from the thread when omitted. */
        readonly scopeKey?: string | undefined;
        /** Runs before the `opened` event publishes, so subscribers find state keyed by the tab. */
        readonly beforePublish?: (snapshot: PreviewSessionSnapshot) => void;
      },
    ) => Effect.Effect<PreviewSessionSnapshot, PreviewError>;
    readonly navigate: (
      input: PreviewNavigateInput,
    ) => Effect.Effect<PreviewSessionSnapshot, PreviewError>;
    readonly reportStatus: (
      input: PreviewReportStatusInput & { readonly serverControlled?: boolean },
    ) => Effect.Effect<void, PreviewError>;
    readonly requestReveal: (
      input: PreviewCloseInput & { readonly tabId: string; readonly force: boolean },
    ) => Effect.Effect<void, PreviewError>;
    readonly resize: (
      input: PreviewResizeInput,
    ) => Effect.Effect<PreviewSessionSnapshot, PreviewError>;
    /**
     * Records a server tab's appearance or zoom and publishes it; the server's
     * browser applies it to the page. Any client may send it, as it changes how
     * the page renders, not what it does.
     */
    readonly adjust: (
      input: PreviewAdjustInput,
    ) => Effect.Effect<PreviewSessionSnapshot, PreviewError>;
    readonly refresh: (input: PreviewRefreshInput) => Effect.Effect<void, PreviewError>;
    /** Closes one tab the caller can see, or without `tabId` every tab `list` returns for it. */
    readonly close: (input: PreviewCloseInput) => Effect.Effect<void, PreviewError>;
    /**
     * Cleanup for a deleted thread: closes the tabs only it could see and, when
     * `scopeKey` is given, every tab of that checkout.
     */
    readonly closeForThread: (input: {
      readonly threadId: string;
      readonly scopeKey?: string | undefined;
    }) => Effect.Effect<void>;
    /** Every tab in the caller's checkout, plus tabs only the caller can see. */
    readonly list: (input: PreviewListInput) => Effect.Effect<PreviewListResult>;
    /**
     * The checkout a caller's tabs belong to; undefined when its thread cannot
     * be resolved. Callers compare it with `previewTabVisibleTo`.
     */
    readonly resolveScope: (threadId: string) => Effect.Effect<string | undefined>;
    readonly events: Stream.Stream<PreviewEvent>;
    readonly subscribeEvents: Effect.Effect<PubSub.Subscription<PreviewEvent>, never, Scope.Scope>;
  }
>()("t3/preview/Manager/PreviewManager") {}

interface PreviewSessionState {
  readonly snapshot: PreviewSessionSnapshot;
}

interface ManagerState {
  /** All sessions across every thread, keyed by `tabId`. */
  readonly sessions: ReadonlyMap<string, PreviewSessionState>;
  /** Global monotonic revision establishing list/event ordering. */
  readonly revision: number;
}

const initialState: ManagerState = { sessions: new Map(), revision: 0 };

type PreviewEventDraft = PreviewEvent extends infer Event
  ? Event extends { readonly revision: number }
    ? Omit<Event, "revision" | "serverEpoch">
    : never
  : never;

/**
 * Whether a caller sees a tab: any thread in the tab's checkout does, and a
 * tab without one is its opening thread's alone.
 */
export const previewTabVisibleTo = (
  tab: { readonly threadId: string; readonly scopeKey?: string | undefined },
  caller: { readonly threadId: string; readonly scopeKey: string | undefined },
): boolean =>
  tab.threadId === caller.threadId ||
  (tab.scopeKey !== undefined && tab.scopeKey === caller.scopeKey);

const sessionsVisibleTo = (
  state: ManagerState,
  caller: { readonly threadId: string; readonly scopeKey: string | undefined },
): ReadonlyArray<PreviewSessionState> => {
  const out: PreviewSessionState[] = [];
  for (const session of state.sessions.values()) {
    if (previewTabVisibleTo(session.snapshot, caller)) out.push(session);
  }
  return out;
};

/** The owner fields every event about a tab carries. */
const eventOwner = (snapshot: PreviewSessionSnapshot) => ({
  threadId: snapshot.threadId,
  ...(snapshot.scopeKey === undefined ? {} : { scopeKey: snapshot.scopeKey }),
});

const normalizeUrl = (rawUrl: string): Effect.Effect<string, PreviewInvalidUrlError> =>
  Effect.try({
    try: () => normalizePreviewUrl(rawUrl),
    catch: (cause) => {
      if (isPreviewUrlNormalizationError(cause)) {
        return new PreviewInvalidUrlError({
          inputLength: cause.inputLength,
          reason: cause.reason,
          protocol: cause.protocol,
          cause,
        });
      }

      return new PreviewInvalidUrlError({
        inputLength: rawUrl.length,
        reason: "unexpected",
        cause,
      });
    },
  });

const currentIsoTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* PreviewManagerMake() {
  const crypto = yield* Crypto.Crypto;
  const worktreeScopes = yield* WorktreeScopes.WorktreeScopes;
  const serverEpoch = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  const stateRef = yield* SynchronizedRef.make<ManagerState>(initialState);
  // Unbounded PubSub is fine here — events are tiny and we don't want to
  // block publishers if a subscriber is slow. WS clients backpressure on
  // their own queues downstream.
  const eventsPubSub = yield* PubSub.unbounded<PreviewEvent>();
  const events: Stream.Stream<PreviewEvent> = Stream.fromPubSub(eventsPubSub);

  // Where clients place threads the server cannot resolve yet (drafts). Bounded:
  // a draft that never sends would otherwise keep its entry for the process's life.
  const clientScopeHints = new Map<string, string>();
  const rememberClientScope = (threadId: string, clientScopeKey: string | undefined) => {
    if (clientScopeKey === undefined) return;
    clientScopeHints.delete(threadId);
    clientScopeHints.set(threadId, worktreeScopeKey({ workspaceRoot: clientScopeKey }));
    if (clientScopeHints.size > CLIENT_SCOPE_HINT_LIMIT) {
      const oldest = clientScopeHints.keys().next().value;
      if (oldest !== undefined) clientScopeHints.delete(oldest);
    }
  };

  const resolveScope: PreviewManager["Service"]["resolveScope"] = (threadId) =>
    worktreeScopes.forThread(threadId).pipe(
      Effect.map((scope) =>
        Option.isSome(scope) ? scope.value.scopeKey : clientScopeHints.get(threadId),
      ),
      // An unresolved thread keeps its tabs to itself rather than failing the request.
      Effect.catch((error) =>
        Effect.logWarning("failed to resolve preview scope", { threadId, error }).pipe(
          Effect.as(undefined),
        ),
      ),
    );

  /**
   * The caller's scope, resolved only when the tab belongs to a checkout and
   * another thread opened it; the opener itself needs no lookup.
   */
  const callerScopeFor = (threadId: string, tabId: string) =>
    Effect.gen(function* () {
      const session = (yield* SynchronizedRef.get(stateRef)).sessions.get(tabId);
      if (
        session === undefined ||
        session.snapshot.threadId === threadId ||
        session.snapshot.scopeKey === undefined
      ) {
        return undefined;
      }
      return yield* resolveScope(threadId);
    });

  /**
   * Atomic read-modify-write over the tab `tabId`, when the caller sees it. The
   * mutator runs under the SynchronizedRef so concurrent writers cannot
   * interleave. Lookup failures travel through the modify result so both
   * branches yield the same `[A, S]` shape `modifyEffect` requires.
   *
   * The event is published INSIDE the lock so observers see events in the
   * same order as the underlying state transitions. Publishing an unbounded
   * PubSub is non-blocking, so this is cheap.
   */
  const mutateExistingSession = <R, E>(
    threadId: string,
    tabId: string,
    mutator: (
      session: PreviewSessionState,
    ) => Effect.Effect<{ next: PreviewSessionState; emit: PreviewEventDraft | null; result: R }, E>,
  ): Effect.Effect<R, E | PreviewSessionLookupError> => {
    type ModifyResult =
      | { kind: "fail"; error: PreviewSessionLookupError }
      | { kind: "ok"; result: R };

    return Effect.flatMap(callerScopeFor(threadId, tabId), (scopeKey) =>
      SynchronizedRef.modifyEffect(stateRef, (state) => {
        const session = state.sessions.get(tabId);
        if (!session || !previewTabVisibleTo(session.snapshot, { threadId, scopeKey })) {
          return Effect.succeed([
            { kind: "fail", error: new PreviewSessionLookupError({ threadId, tabId }) },
            state,
          ] as readonly [ModifyResult, ManagerState]);
        }
        return mutator(session).pipe(
          Effect.flatMap(
            Effect.fn("PreviewManager.commitMutation")(function* ({ next, emit, result }) {
              const revision = emit ? state.revision + 1 : state.revision;
              if (emit) {
                yield* PubSub.publish(eventsPubSub, {
                  ...emit,
                  revision,
                  serverEpoch,
                } as PreviewEvent);
              }
              const sessions = new Map(state.sessions);
              sessions.set(tabId, next);
              return [{ kind: "ok", result } as ModifyResult, { sessions, revision }] as readonly [
                ModifyResult,
                ManagerState,
              ];
            }),
          ),
        );
      }),
    ).pipe(
      Effect.flatMap((modify) =>
        modify.kind === "fail" ? Effect.fail(modify.error) : Effect.succeed(modify.result),
      ),
    );
  };

  const open: PreviewManager["Service"]["open"] = Effect.fn("PreviewManager.open")(
    function* (input) {
      const runtime = input.runtime;
      // Persisted client surfaces must not bind to a different tab after a server restart.
      const tabId = `${newPreviewTabId()}${runtime === "server" ? `_${serverEpoch}` : ""}`;
      const updatedAt = yield* currentIsoTimestamp;
      rememberClientScope(input.threadId, input.clientScopeKey);
      const scopeKey = input.scopeKey ?? (yield* resolveScope(input.threadId));
      const snapshot: PreviewSessionSnapshot = {
        threadId: input.threadId,
        ...(scopeKey === undefined ? {} : { scopeKey }),
        tabId,
        navStatus: input.url
          ? { _tag: "Loading", url: yield* normalizeUrl(input.url), title: "" }
          : { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        viewport: input.viewport ?? FILL_PREVIEW_VIEWPORT,
        ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
        ...(runtime === undefined ? {} : { runtime }),
        ...(runtime === "server" && input.automationOwner !== undefined
          ? { automationOwner: input.automationOwner }
          : {}),
        ...(input.reveal === undefined ? {} : { reveal: input.reveal }),
        updatedAt,
      };
      yield* SynchronizedRef.modifyEffect(stateRef, (state) =>
        Effect.gen(function* () {
          const revision = state.revision + 1;
          const sessions = new Map(state.sessions);
          sessions.set(tabId, { snapshot });
          input.beforePublish?.(snapshot);
          yield* PubSub.publish(eventsPubSub, {
            type: "opened",
            ...eventOwner(snapshot),
            tabId,
            createdAt: snapshot.updatedAt,
            serverEpoch,
            revision,
            snapshot,
          });
          return [snapshot, { sessions, revision }] as const;
        }),
      );
      return snapshot;
    },
  );

  const navigate: PreviewManager["Service"]["navigate"] = Effect.fn("PreviewManager.navigate")(
    function* (input) {
      const url = yield* normalizeUrl(input.url);
      return yield* mutateExistingSession(
        input.threadId,
        input.tabId,
        Effect.fn("PreviewManager.navigateSession")(function* (session) {
          if (session.snapshot.runtime === "server")
            return yield* new PreviewControlRequiredError({ tabId: input.tabId });
          const updatedAt = yield* currentIsoTimestamp;
          const previousTitle =
            session.snapshot.navStatus._tag === "Idle" ? "" : session.snapshot.navStatus.title;
          const resolvedTitle = input.resolvedTitle ?? previousTitle;
          const snapshot: PreviewSessionSnapshot = {
            ...session.snapshot,
            navStatus: { _tag: "Success", url, title: resolvedTitle },
            viewport: session.snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
            updatedAt,
          };
          return {
            next: { ...session, snapshot },
            emit: {
              type: "navigated",
              ...eventOwner(session.snapshot),
              tabId: session.snapshot.tabId,
              createdAt: snapshot.updatedAt,
              snapshot,
            },
            result: snapshot,
          };
        }),
      );
    },
  );

  const reportStatus: PreviewManager["Service"]["reportStatus"] = Effect.fn(
    "PreviewManager.reportStatus",
  )(function* (input) {
    yield* mutateExistingSession(
      input.threadId,
      input.tabId,
      Effect.fn("PreviewManager.reportSessionStatus")(function* (session) {
        if (session.snapshot.runtime === "server" && !input.serverControlled)
          return yield* new PreviewControlRequiredError({ tabId: input.tabId });
        const updatedAt = yield* currentIsoTimestamp;
        const snapshot: PreviewSessionSnapshot = {
          ...session.snapshot,
          navStatus: input.navStatus,
          canGoBack: input.canGoBack,
          canGoForward: input.canGoForward,
          viewport: session.snapshot.viewport ?? FILL_PREVIEW_VIEWPORT,
          updatedAt,
        };
        const emit: PreviewEventDraft =
          input.navStatus._tag === "LoadFailed"
            ? {
                type: "failed",
                ...eventOwner(session.snapshot),
                tabId: session.snapshot.tabId,
                createdAt: snapshot.updatedAt,
                url: input.navStatus.url,
                title: input.navStatus.title,
                code: input.navStatus.code,
                description: input.navStatus.description,
                ...(input.navStatus.download === undefined
                  ? {}
                  : { download: input.navStatus.download }),
              }
            : {
                type: "navigated",
                ...eventOwner(session.snapshot),
                tabId: session.snapshot.tabId,
                createdAt: snapshot.updatedAt,
                snapshot,
              };
        return {
          next: { ...session, snapshot },
          emit,
          result: undefined as void,
        };
      }),
    );
  });

  const resize: PreviewManager["Service"]["resize"] = Effect.fn("PreviewManager.resize")(
    function* (input) {
      return yield* mutateExistingSession(
        input.threadId,
        input.tabId,
        // Any client may size a tab, as the desktop has always allowed; the
        // server's browser follows the published setting for its own tabs.
        Effect.fn("PreviewManager.resizeSession")(function* (session) {
          const updatedAt = yield* currentIsoTimestamp;
          const snapshot: PreviewSessionSnapshot = {
            ...session.snapshot,
            viewport: input.viewport,
            updatedAt,
          };
          return {
            next: { ...session, snapshot },
            emit: {
              type: "resized",
              ...eventOwner(session.snapshot),
              tabId: session.snapshot.tabId,
              createdAt: snapshot.updatedAt,
              snapshot,
            },
            result: snapshot,
          };
        }),
      );
    },
  );

  const adjust: PreviewManager["Service"]["adjust"] = Effect.fn("PreviewManager.adjust")(
    function* (input) {
      return yield* mutateExistingSession(
        input.threadId,
        input.tabId,
        Effect.fn("PreviewManager.adjustSession")(function* (session) {
          const updatedAt = yield* currentIsoTimestamp;
          const snapshot: PreviewSessionSnapshot = {
            ...session.snapshot,
            ...(input.colorScheme === undefined ? {} : { colorScheme: input.colorScheme }),
            ...(input.zoomFactor === undefined ? {} : { zoomFactor: input.zoomFactor }),
            updatedAt,
          };
          // One-off requests ride on the event for the server's browser to act on.
          const request =
            input.hardReload || input.clear
              ? {
                  request: {
                    ...(input.hardReload ? { hardReload: true } : {}),
                    ...(input.clear ? { clear: input.clear } : {}),
                  },
                }
              : {};
          return {
            next: { ...session, snapshot },
            emit: {
              ...request,
              type: "resized",
              ...eventOwner(session.snapshot),
              tabId: session.snapshot.tabId,
              createdAt: snapshot.updatedAt,
              snapshot,
            },
            result: snapshot,
          };
        }),
      );
    },
  );

  const refresh: PreviewManager["Service"]["refresh"] = Effect.fn("PreviewManager.refresh")(
    function* (input) {
      // Verify the session exists; the desktop bridge handles the actual reload
      // and will report progress back via `reportStatus`. No event emitted.
      yield* mutateExistingSession(input.threadId, input.tabId, (session) =>
        Effect.succeed({ next: session, emit: null, result: undefined as void }),
      );
    },
  );

  /** Removes the sessions `pick` selects and publishes a `closed` event for each. */
  const closeWhere = (pick: (state: ManagerState) => ReadonlyArray<PreviewSessionState>) =>
    Effect.gen(function* () {
      const createdAt = yield* currentIsoTimestamp;
      yield* SynchronizedRef.modifyEffect(stateRef, (state) => {
        const eventsToEmit: PreviewEvent[] = [];
        const sessions = new Map(state.sessions);
        let revision = state.revision;
        for (const target of pick(state)) {
          revision += 1;
          sessions.delete(target.snapshot.tabId);
          eventsToEmit.push({
            type: "closed",
            ...eventOwner(target.snapshot),
            tabId: target.snapshot.tabId,
            createdAt,
            serverEpoch,
            revision,
          });
        }
        if (eventsToEmit.length === 0) {
          return Effect.succeed([undefined, state] as const);
        }
        return Effect.as(
          Effect.forEach(eventsToEmit, (event) => PubSub.publish(eventsPubSub, event), {
            discard: true,
          }),
          [undefined, { sessions, revision }] as const,
        );
      });
    });

  const close: PreviewManager["Service"]["close"] = Effect.fn("PreviewManager.close")(
    function* (input) {
      const tabId = input.tabId;
      const caller = {
        threadId: input.threadId,
        scopeKey:
          tabId === undefined
            ? yield* resolveScope(input.threadId)
            : yield* callerScopeFor(input.threadId, tabId),
      };
      yield* closeWhere((state) => {
        if (tabId === undefined) return sessionsVisibleTo(state, caller);
        const session = state.sessions.get(tabId);
        return session && previewTabVisibleTo(session.snapshot, caller) ? [session] : [];
      });
    },
  );

  const closeForThread: PreviewManager["Service"]["closeForThread"] = Effect.fn(
    "PreviewManager.closeForThread",
  )(function* (input) {
    yield* closeWhere((state) =>
      [...state.sessions.values()].filter(({ snapshot }) =>
        snapshot.scopeKey === undefined
          ? snapshot.threadId === input.threadId
          : snapshot.scopeKey === input.scopeKey,
      ),
    );
  });

  const list: PreviewManager["Service"]["list"] = Effect.fn("PreviewManager.list")(
    function* (input) {
      rememberClientScope(input.threadId, input.clientScopeKey);
      const scopeKey = yield* resolveScope(input.threadId);
      return yield* SynchronizedRef.get(stateRef).pipe(
        Effect.map((state): PreviewListResult => ({
          sessions: sessionsVisibleTo(state, { threadId: input.threadId, scopeKey })
            .map((s) => s.snapshot)
            .toSorted((a, b) => a.updatedAt.localeCompare(b.updatedAt)),
          serverEpoch,
          revision: state.revision,
        })),
      );
    },
  );

  const requestReveal: PreviewManager["Service"]["requestReveal"] = Effect.fn(
    "PreviewManager.requestReveal",
  )(function* (input) {
    yield* mutateExistingSession(
      input.threadId,
      input.tabId,
      Effect.fn("PreviewManager.revealSession")(function* (session) {
        const snapshot = {
          ...session.snapshot,
          reveal: true,
          revealRequest: {
            id: yield* crypto.randomUUIDv4.pipe(Effect.orDie),
            force: input.force,
          },
          updatedAt: yield* currentIsoTimestamp,
        };
        return {
          next: { ...session, snapshot },
          emit: {
            type: "navigated" as const,
            ...eventOwner(session.snapshot),
            tabId: session.snapshot.tabId,
            createdAt: snapshot.updatedAt,
            snapshot,
          },
          result: undefined,
        };
      }),
    );
  });

  return PreviewManager.of({
    open,
    requestReveal,
    navigate,
    reportStatus,
    resize,
    adjust,
    refresh,
    close,
    closeForThread,
    list,
    resolveScope,
    events,
    subscribeEvents: PubSub.subscribe(eventsPubSub),
  });
}).pipe(Effect.withSpan("PreviewManager.make"));

export const layer = Layer.effect(PreviewManager, make);
