import { useAtomValue } from "@effect/atom-react";
import {
  type CheckpointDiffTarget,
  type ComposerPathSearchTarget,
} from "@t3tools/client-runtime/state/threads";
import {
  createThreadSearchResultsAtomFamily,
  makeThreadSearchKey,
  type EnvironmentThreadSearchMatch,
} from "@t3tools/client-runtime/state/thread-search";
import { type VcsRefTarget } from "@t3tools/client-runtime/state/vcs";
import {
  EnvironmentId,
  type OrchestrationArchivedThreadSearchIndex,
  ProjectId,
  type ProjectContentMatch,
  type ProjectEntry,
  type ProjectEntryKind,
  type ScopedProjectRef,
  type ThreadId,
  type TurnItemId,
  type VcsListRefsResult,
  type VcsRef,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { useFilesystemReadAccess } from "./filesystem";
import { orchestrationEnvironment } from "./orchestration";
import { isPaginatedBranchesNextPagePending } from "./paginatedBranches";
import { projectContentSearch, projectEnvironment } from "./projects";
import { useEnvironmentQuery } from "./query";
import { vcsEnvironment } from "./vcs";

const PROJECT_PATH_SEARCH_DEBOUNCE_MS = 120;
const COMPOSER_PATH_SEARCH_LIMIT = 80;
const PROJECT_CONTENT_SEARCH_DEBOUNCE_MS = 120;
const PROJECT_CONTENT_SEARCH_LIMIT = 500;
const THREAD_SEARCH_DEBOUNCE_MS = 200;
const VCS_REF_LIST_LIMIT = 100;
const EMPTY_REFS: ReadonlyArray<VcsRef> = [];
const EMPTY_PROJECT_ENTRIES: ReadonlyArray<ProjectEntry> = [];
const EMPTY_CONTENT_MATCHES: ReadonlyArray<ProjectContentMatch> = [];
const INITIAL_BRANCH_CURSORS = [undefined] as const;
const EMPTY_THREAD_SEARCH_MATCHES: ReadonlyArray<EnvironmentThreadSearchMatch> = Object.freeze([]);
const EMPTY_THREAD_SEARCH_ATOM = Atom.make({
  matches: EMPTY_THREAD_SEARCH_MATCHES,
  isLoading: false,
}).pipe(Atom.withLabel("web:thread-search:empty"));

const threadSearchResultsAtom = createThreadSearchResultsAtomFamily({
  getSearchAtom: (environmentId, query) =>
    orchestrationEnvironment.threadSearch({
      environmentId,
      input: { query },
    }),
  labelPrefix: "web:thread-search",
});

export function useDebouncedValue<A>(value: A, delayMs: number): A {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [delayMs, value]);

  return debounced;
}

export function useThreadSearch(
  environmentIds: ReadonlyArray<EnvironmentId>,
  query: string,
): {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  /** The settled query `matches` came from; it only changes when results do. */
  readonly query: string;
  readonly isPending: boolean;
} {
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch = environmentIds.length > 0 && normalizedQuery.length >= 2;
  const settledQuery = canSearch && normalizedQuery === debouncedQuery ? debouncedQuery : null;
  const searchKey = useMemo(
    () => (settledQuery === null ? null : makeThreadSearchKey(environmentIds, settledQuery)),
    [environmentIds, settledQuery],
  );
  const result = useAtomValue(
    searchKey === null ? EMPTY_THREAD_SEARCH_ATOM : threadSearchResultsAtom(searchKey),
  );
  const isDebouncing = canSearch && normalizedQuery !== debouncedQuery;
  return {
    matches: isDebouncing ? EMPTY_THREAD_SEARCH_MATCHES : result.matches,
    query: settledQuery ?? "",
    isPending: canSearch && (isDebouncing || result.isLoading),
  };
}

interface ArchivedThreadSearchState {
  readonly matches: ReadonlyArray<EnvironmentThreadSearchMatch>;
  /** Summed over environments; null until every environment has answered once. */
  readonly index: OrchestrationArchivedThreadSearchIndex | null;
}

const ArchivedThreadSearchKey = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Array(Schema.Tuple([EnvironmentId, Schema.Array(ProjectId)])),
    Schema.String,
  ]),
);
const decodeArchivedThreadSearchKey = Schema.decodeUnknownOption(ArchivedThreadSearchKey);
const INDEX_STATUS_WEIGHT = { preparing: 3, indexing: 2, unavailable: 1, ready: 0 } as const;
const EMPTY_ARCHIVED_THREAD_SEARCH_ATOM = Atom.make<ArchivedThreadSearchState>({
  matches: EMPTY_THREAD_SEARCH_MATCHES,
  index: null,
}).pipe(Atom.withLabel("web:archived-thread-search:empty"));

// Environments that predate archived search fail the call; they add no
// matches and leave the dialog's title filter to stand in.
const archivedThreadSearchAtom = Atom.family((key: string) =>
  Atom.make((get): ArchivedThreadSearchState => {
    const parsed = decodeArchivedThreadSearchKey(key);
    if (Option.isNone(parsed)) return { matches: [], index: null };
    const [scopes, query] = parsed.value;
    const matches: EnvironmentThreadSearchMatch[] = [];
    let index: OrchestrationArchivedThreadSearchIndex | null = {
      status: "ready",
      indexed: 0,
      total: 0,
    };
    for (const [environmentId, projectIds] of scopes) {
      const result = get(
        orchestrationEnvironment.archivedThreadSearch({
          environmentId,
          input: { query, projectIds },
        }),
      );
      const value = Option.getOrNull(AsyncResult.value(result));
      if (value === null) {
        if (result._tag !== "Failure") index = null;
        continue;
      }
      matches.push(...value.matches.map((match) => ({ ...match, environmentId })));
      if (index === null) continue;
      index = {
        status:
          INDEX_STATUS_WEIGHT[value.index.status] > INDEX_STATUS_WEIGHT[index.status]
            ? value.index.status
            : index.status,
        indexed: index.indexed + value.index.indexed,
        total: index.total + value.index.total,
      };
    }
    return { matches, index };
  }).pipe(Atom.withLabel(`web:archived-thread-search:${key}`)),
);

/** Archived threads in `projectRefs` that match `query` by keyword or meaning. */
export function useArchivedThreadSearch(
  projectRefs: ReadonlyArray<ScopedProjectRef>,
  query: string,
): ArchivedThreadSearchState & { readonly isPending: boolean } {
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebouncedValue(normalizedQuery, THREAD_SEARCH_DEBOUNCE_MS);
  const canSearch = projectRefs.length > 0 && normalizedQuery.length >= 2;
  const settledQuery = canSearch && normalizedQuery === debouncedQuery ? debouncedQuery : null;
  const searchKey = useMemo(() => {
    if (settledQuery === null) return null;
    const byEnvironment = new Map<EnvironmentId, ProjectId[]>();
    for (const ref of projectRefs) {
      byEnvironment.set(ref.environmentId, [
        ...(byEnvironment.get(ref.environmentId) ?? []),
        ref.projectId,
      ]);
    }
    const scopes = [...byEnvironment.entries()]
      .map(([environmentId, projectIds]) => [environmentId, projectIds.toSorted()] as const)
      .toSorted(([left], [right]) => left.localeCompare(right));
    return JSON.stringify([scopes, settledQuery]);
  }, [projectRefs, settledQuery]);
  const result = useAtomValue(
    searchKey === null ? EMPTY_ARCHIVED_THREAD_SEARCH_ATOM : archivedThreadSearchAtom(searchKey),
  );
  const isDebouncing = canSearch && normalizedQuery !== debouncedQuery;
  return {
    matches: isDebouncing ? EMPTY_THREAD_SEARCH_MATCHES : result.matches,
    index: isDebouncing ? null : result.index,
    isPending: canSearch && (isDebouncing || result.index === null),
  };
}

export function usePaginatedBranches(target: VcsRefTarget) {
  const query = target.query?.trim() ?? "";
  const targetKey =
    target.environmentId !== null && target.cwd !== null
      ? JSON.stringify([target.environmentId, target.cwd, query])
      : null;
  const [pagination, setPagination] = useState<{
    readonly targetKey: string | null;
    readonly cursors: ReadonlyArray<number | undefined>;
  }>({
    targetKey,
    cursors: INITIAL_BRANCH_CURSORS,
  });
  const cursors = pagination.targetKey === targetKey ? pagination.cursors : INITIAL_BRANCH_CURSORS;
  const pageAtoms = useMemo(
    () =>
      target.environmentId !== null && target.cwd !== null
        ? cursors.map((cursor) =>
            vcsEnvironment.listRefs({
              environmentId: target.environmentId!,
              input: {
                cwd: target.cwd!,
                ...(query.length > 0 ? { query } : {}),
                ...(cursor === undefined ? {} : { cursor }),
                limit: VCS_REF_LIST_LIMIT,
              },
            }),
          )
        : [],
    [cursors, query, target.cwd, target.environmentId],
  );
  const pagesAtom = useMemo(
    () =>
      Atom.make((get) => pageAtoms.map((atom) => get(atom))).pipe(
        Atom.withLabel(`web:vcs-ref-pages:${targetKey ?? "empty"}`),
      ),
    [pageAtoms, targetKey],
  );
  const results = useAtomValue(pagesAtom);
  const values = results.flatMap((result) => {
    const value = Option.getOrNull(AsyncResult.value(result));
    return value === null ? [] : [value];
  });
  const refs = new Map<string, VcsRef>();
  for (const value of values) {
    for (const ref of value.refs) {
      refs.set(ref.name, ref);
    }
  }
  const first = values[0] ?? null;
  const last = values.at(-1) ?? null;
  const data: VcsListRefsResult | null =
    first === null || last === null
      ? null
      : {
          refs: [...refs.values()],
          isRepo: first.isRepo,
          hasPrimaryRemote: first.hasPrimaryRemote,
          nextCursor: last.nextCursor,
          totalCount: Math.max(...values.map((value) => value.totalCount)),
        };
  const failed = results.find((result) => result._tag === "Failure");
  const isFetchingNextPage = isPaginatedBranchesNextPagePending(results);
  const error =
    failed?._tag === "Failure"
      ? (() => {
          const cause = Cause.squash(failed.cause);
          return cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : "Failed to load refs.";
        })()
      : null;
  const refresh = useCallback(() => {
    const firstPage = pageAtoms[0];
    setPagination({ targetKey, cursors: INITIAL_BRANCH_CURSORS });
    if (firstPage !== undefined) {
      appAtomRegistry.refresh(firstPage);
    }
  }, [pageAtoms, targetKey]);
  const loadNext = useCallback(() => {
    if (targetKey === null || data?.nextCursor === null || data?.nextCursor === undefined) {
      return;
    }
    setPagination((current) => {
      const currentCursors =
        current.targetKey === targetKey ? current.cursors : INITIAL_BRANCH_CURSORS;
      return currentCursors.includes(data.nextCursor!)
        ? { targetKey, cursors: currentCursors }
        : { targetKey, cursors: [...currentCursors, data.nextCursor!] };
    });
  }, [data?.nextCursor, targetKey]);

  return {
    data,
    refs: data?.refs ?? EMPTY_REFS,
    error,
    isPending: results.some((result) => result.waiting),
    isFetchingNextPage,
    refresh,
    loadNext,
  };
}

type ProjectPathSearchTarget = ComposerPathSearchTarget & {
  readonly kind?: ProjectEntryKind | undefined;
  readonly imageOnly?: boolean | undefined;
};

export function areProjectPathSearchTargetsEqual(
  left: ProjectPathSearchTarget,
  right: ProjectPathSearchTarget,
): boolean {
  return (
    left.environmentId === right.environmentId &&
    left.cwd === right.cwd &&
    left.query === right.query &&
    left.kind === right.kind &&
    left.imageOnly === right.imageOnly
  );
}

export function useProjectPathSearch(
  target: ProjectPathSearchTarget,
  limit: number,
  options?: { readonly allowEmptyQuery?: boolean },
) {
  const allowEmptyQuery = options?.allowEmptyQuery === true;
  const normalizedTarget = useMemo(
    () => ({
      environmentId: target.environmentId,
      cwd: target.cwd,
      query: target.query == null ? null : target.query.trim(),
      kind: target.kind,
      imageOnly: target.imageOnly,
    }),
    [target.cwd, target.environmentId, target.imageOnly, target.kind, target.query],
  );
  const debouncedTarget = useDebouncedValue(normalizedTarget, PROJECT_PATH_SEARCH_DEBOUNCE_MS);
  const fileAccess = useFilesystemReadAccess(debouncedTarget.environmentId);
  const { canReadFiles } = fileAccess;
  const searchTarget =
    debouncedTarget.environmentId !== null &&
    debouncedTarget.cwd !== null &&
    debouncedTarget.query !== null &&
    (allowEmptyQuery || debouncedTarget.query.length > 0)
      ? {
          environmentId: debouncedTarget.environmentId,
          input: {
            cwd: debouncedTarget.cwd,
            query: debouncedTarget.query,
            limit,
            ...(debouncedTarget.kind ? { kind: debouncedTarget.kind } : {}),
            ...(debouncedTarget.imageOnly ? { imageOnly: true } : {}),
          },
        }
      : null;
  const result = useEnvironmentQuery(
    canReadFiles && searchTarget !== null ? projectEnvironment.searchEntries(searchTarget) : null,
  );
  const hasTarget = searchTarget !== null;

  return {
    entries: result.data?.entries ?? EMPTY_PROJECT_ENTRIES,
    error:
      !hasTarget || fileAccess.isPending
        ? null
        : canReadFiles
          ? result.error
          : (fileAccess.error ?? "This connection cannot search host files."),
    isPending:
      !areProjectPathSearchTargetsEqual(normalizedTarget, debouncedTarget) ||
      (hasTarget && (fileAccess.isPending || result.isPending)),
    searchedQuery: debouncedTarget.query ?? "",
    truncated: result.data?.truncated ?? false,
    refresh: result.refresh,
  };
}

export function useComposerPathSearch(target: ComposerPathSearchTarget) {
  return useProjectPathSearch(target, COMPOSER_PATH_SEARCH_LIMIT);
}

interface ProjectContentSearchTarget {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly useRegex: boolean;
}

export function useProjectContentSearch(target: ProjectContentSearchTarget) {
  const hasTarget = target.environmentId !== null && target.cwd !== null;
  const fileAccess = useFilesystemReadAccess(target.environmentId);
  const canReadFiles = hasTarget && fileAccess.canReadFiles;
  const isCheckingAccess = hasTarget && fileAccess.isPending;
  // Whitespace is significant in content queries; trimming is only used to
  // decide whether the input is blank.
  const query = target.query;
  const hasQuery = query.trim().length > 0;
  const debouncedQuery = useDebouncedValue(query, PROJECT_CONTENT_SEARCH_DEBOUNCE_MS);
  const result = useEnvironmentQuery(
    canReadFiles &&
      target.environmentId !== null &&
      target.cwd !== null &&
      hasQuery &&
      debouncedQuery.trim().length > 0
      ? projectContentSearch({
          environmentId: target.environmentId,
          input: {
            cwd: target.cwd,
            query: debouncedQuery,
            limit: PROJECT_CONTENT_SEARCH_LIMIT,
            caseSensitive: target.caseSensitive,
            wholeWord: target.wholeWord,
            useRegex: target.useRegex,
          },
        })
      : null,
  );

  return {
    canReadFiles,
    isCheckingAccess,
    matches: result.data?.matches ?? EMPTY_CONTENT_MATCHES,
    error:
      !hasTarget || isCheckingAccess
        ? null
        : canReadFiles
          ? result.error
          : (fileAccess.error ?? "This connection cannot search host files."),
    isPending:
      isCheckingAccess ||
      (canReadFiles && hasQuery && (query !== debouncedQuery || result.isPending)),
    hasQuery,
    truncated: result.data?.truncated ?? false,
    invalidRegex: target.useRegex && result.data?.regexFallbackError !== undefined,
  };
}

export function useCheckpointDiff(
  target: CheckpointDiffTarget,
  options?: { readonly enabled?: boolean },
) {
  const enabled =
    options?.enabled !== false &&
    target.environmentId !== null &&
    target.threadId !== null &&
    target.fromTurnCount !== null &&
    target.toTurnCount !== null;
  const fullThreadTarget =
    enabled && target.fromTurnCount === 0
      ? {
          environmentId: target.environmentId!,
          input: {
            threadId: target.threadId!,
            toTurnCount: target.toTurnCount!,
            ignoreWhitespace: target.ignoreWhitespace,
          },
        }
      : null;
  const turnTarget =
    enabled && target.fromTurnCount !== 0
      ? {
          environmentId: target.environmentId!,
          input: {
            threadId: target.threadId!,
            fromTurnCount: target.fromTurnCount!,
            toTurnCount: target.toTurnCount!,
            ignoreWhitespace: target.ignoreWhitespace,
          },
        }
      : null;
  const fullThread = useEnvironmentQuery(
    fullThreadTarget === null ? null : orchestrationEnvironment.fullThreadDiff(fullThreadTarget),
  );
  const turn = useEnvironmentQuery(
    turnTarget === null ? null : orchestrationEnvironment.turnDiff(turnTarget),
  );
  return fullThreadTarget === null ? turn : fullThread;
}

/** Full input and output of one timeline item, fetched only while its row is open. */
export function useTurnItemDetail(
  target: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
    readonly revision: string;
  } | null,
) {
  return useEnvironmentQuery(
    target === null
      ? null
      : orchestrationEnvironment.turnItem({
          environmentId: target.environmentId,
          input: { threadId: target.threadId, itemId: target.itemId, revision: target.revision },
        }),
  );
}
