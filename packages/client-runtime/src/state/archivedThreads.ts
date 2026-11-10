import {
  type ArchivedThreadSortOrder,
  EnvironmentId,
  type OrchestrationV2ArchivedShellSnapshot,
} from "@t3tools/contracts";
import * as Arr from "effect/Array";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import { AsyncResult, Atom } from "effect/reactivity";

export interface ArchivedSnapshotEntry {
  readonly environmentId: EnvironmentId;
  readonly snapshot: OrchestrationV2ArchivedShellSnapshot;
}

export interface ArchivedThreadSnapshotsState {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly error: string | null;
  readonly isLoading: boolean;
}

const ARCHIVED_THREADS_ENVIRONMENT_KEY_SEPARATOR = "\u001f";
const environmentIdOrder = Order.String as Order.Order<EnvironmentId>;

export function makeArchivedThreadsEnvironmentKey(
  environmentIds: ReadonlyArray<EnvironmentId>,
): string {
  return pipe(environmentIds, Arr.sort(environmentIdOrder), (sortedEnvironmentIds) =>
    sortedEnvironmentIds.join(ARCHIVED_THREADS_ENVIRONMENT_KEY_SEPARATOR),
  );
}

export function parseArchivedThreadsEnvironmentKey(key: string): ReadonlyArray<EnvironmentId> {
  if (key.length === 0) {
    return [];
  }
  return pipe(
    key.split(ARCHIVED_THREADS_ENVIRONMENT_KEY_SEPARATOR),
    Arr.map((environmentId) => EnvironmentId.make(environmentId)),
  );
}

export function createArchivedThreadSnapshotsAtomFamily<E>(options: {
  readonly getSnapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<AsyncResult.AsyncResult<OrchestrationV2ArchivedShellSnapshot, E>>;
  readonly labelPrefix: string;
}) {
  return Atom.family((environmentKey: string) =>
    Atom.make((get): ArchivedThreadSnapshotsState => {
      const snapshots: ArchivedSnapshotEntry[] = [];
      let error: string | null = null;
      let isLoading = false;

      for (const environmentId of parseArchivedThreadsEnvironmentKey(environmentKey)) {
        const result = get(options.getSnapshotAtom(environmentId));
        isLoading ||= result.waiting;

        const snapshot = Option.getOrNull(AsyncResult.value(result));
        if (snapshot !== null) {
          snapshots.push({ environmentId, snapshot });
        }

        if (error === null && result._tag === "Failure") {
          error = "Failed to load archived threads.";
        }
      }

      return { snapshots, error, isLoading };
    }).pipe(Atom.withLabel(`${options.labelPrefix}:${environmentKey}`)),
  );
}

/** What the archived lists need from a thread to order and nest it. */
export interface ArchivedThreadEntry {
  readonly id: string;
  readonly lineage: {
    readonly parentThreadId: string | null;
    readonly relationshipToParent: string | null;
  };
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly latestRun: {
    readonly requestedAt: string | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  } | null;
}

/**
 * When the thread last did anything: its latest run, or its creation without one. Not
 * `updatedAt`, which archiving itself moves.
 */
export function archivedThreadLastActivityAt(thread: ArchivedThreadEntry): string {
  const run = thread.latestRun;
  return run?.completedAt ?? run?.startedAt ?? run?.requestedAt ?? thread.createdAt;
}

/** The time an archived list orders a thread by. */
export function archivedThreadSortTime(
  thread: ArchivedThreadEntry,
  order: ArchivedThreadSortOrder,
): string {
  return order === "last_activity"
    ? archivedThreadLastActivityAt(thread)
    : (thread.archivedAt ?? thread.updatedAt);
}

/** An archived agent and the archived subagents under it, at any depth. */
export interface ArchivedThreadFamily<T> {
  readonly thread: T;
  readonly subagents: ReadonlyArray<T>;
}

/**
 * Nests archived subagents under their furthest archived ancestor among `threads`, which share one
 * environment. A subagent whose agent is not in `threads` (still active, or filtered out) stands as
 * a family of its own. Families and the subagents in each run newest first by `order`, or oldest
 * first with `oldestFirst`.
 */
export function archivedThreadFamilies<T extends ArchivedThreadEntry>(
  threads: ReadonlyArray<T>,
  order: ArchivedThreadSortOrder,
  options: { readonly oldestFirst?: boolean } = {},
): ArchivedThreadFamily<T>[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const rootOf = (thread: T) => {
    let root = thread;
    for (let depth = 0; depth < 32; depth += 1) {
      const parentId = root.lineage.parentThreadId;
      if (root.lineage.relationshipToParent !== "subagent" || parentId === null) break;
      const parent = byId.get(parentId);
      if (parent === undefined) break;
      root = parent;
    }
    return root;
  };
  const direction = options.oldestFirst === true ? 1 : -1;
  const compare = (left: T, right: T) =>
    direction *
      archivedThreadSortTime(left, order).localeCompare(archivedThreadSortTime(right, order)) ||
    left.id.localeCompare(right.id);
  const subagentsOf = new Map<string, T[]>();
  for (const thread of threads) {
    const root = rootOf(thread);
    if (root === thread) continue;
    const subagents = subagentsOf.get(root.id);
    if (subagents === undefined) subagentsOf.set(root.id, [thread]);
    else subagents.push(thread);
  }
  return threads
    .filter((thread) => rootOf(thread) === thread)
    .sort(compare)
    .map((thread) => ({
      thread,
      subagents: [...(subagentsOf.get(thread.id) ?? [])].sort(compare),
    }));
}

/** Whether the provider or an agent spawned this thread as a subagent. */
export function isArchivedSubagent(thread: ArchivedThreadEntry): boolean {
  return thread.lineage.relationshipToParent === "subagent";
}
