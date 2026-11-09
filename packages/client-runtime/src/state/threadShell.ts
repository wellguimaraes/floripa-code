import type {
  EnvironmentId,
  OrchestrationV2ShellSnapshot,
  OrchestrationV2ThreadShell,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { isProviderNativeSubagentThread } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentThreadShell } from "./models.ts";
import { presentThreadShell } from "./models.ts";
import { type EnvironmentCatalogState, enabledEnvironmentIds } from "./connections.ts";
import { hiddenThreadKeys, NO_HIDDEN_THREADS } from "./threadTagFilter.ts";
import {
  arrayElementsEqual,
  parseProjectRefCollectionKey,
  parseThreadKey,
  projectRefCollectionKey,
  threadKey,
  threadRefsEqual,
} from "./entities.ts";

const EMPTY_THREADS: ReadonlyArray<OrchestrationV2ThreadShell> = Object.freeze([]);
const EMPTY_SCOPED_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);
const EMPTY_THREAD_INDEX: ReadonlyMap<ThreadId, OrchestrationV2ThreadShell> = new Map();
const EMPTY_THREAD_REFS_BY_PROJECT: ReadonlyMap<
  ProjectId,
  ReadonlyArray<ScopedThreadRef>
> = new Map();

export function createEnvironmentThreadShellAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationV2ShellSnapshot | null>;
  /** Tags whose threads display lists leave out; null while the filter is off. */
  readonly hiddenThreadTagsAtom?: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<ReadonlyArray<string> | null>;
}) {
  // Point reads and aggregate lists share values without keeping an atom alive
  // for every listed thread. Replaced source objects can be collected.
  const scopedThreads = new WeakMap<
    OrchestrationV2ThreadShell,
    Map<EnvironmentId, EnvironmentThreadShell>
  >();
  const scopedThread = (environmentId: EnvironmentId, thread: OrchestrationV2ThreadShell) => {
    let byEnvironment = scopedThreads.get(thread);
    if (byEnvironment === undefined) {
      byEnvironment = new Map();
      scopedThreads.set(thread, byEnvironment);
    }
    let value = byEnvironment.get(environmentId);
    if (value === undefined) {
      value = presentThreadShell(environmentId, thread);
      byEnvironment.set(environmentId, value);
    }
    return value;
  };

  const environmentThreadsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationV2ThreadShell> =>
        get(input.snapshotAtom(environmentId))?.threads ?? EMPTY_THREADS,
    ).pipe(Atom.withLabel(`environment-threads:${environmentId}`)),
  );

  const environmentThreadIndexAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyMap<ThreadId, OrchestrationV2ThreadShell> => {
      const threads = get(environmentThreadsAtom(environmentId));
      if (threads.length === 0) {
        return EMPTY_THREAD_INDEX;
      }
      return new Map(threads.map((thread) => [thread.id, thread] as const));
    }).pipe(Atom.withLabel(`environment-thread-index:${environmentId}`)),
  );

  const environmentThreadRefsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<ScopedThreadRef> = [];
    return Atom.make((get) => {
      const next = get(environmentThreadsAtom(environmentId)).map((thread) => ({
        environmentId,
        threadId: thread.id,
      }));
      if (threadRefsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-thread-refs:${environmentId}`));
  });

  const environmentThreadRefsByProjectAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyMap<
      ProjectId,
      ReadonlyArray<ScopedThreadRef>
    > = EMPTY_THREAD_REFS_BY_PROJECT;
    return Atom.make((get) => {
      const grouped = new Map<ProjectId, ScopedThreadRef[]>();
      for (const thread of get(environmentThreadsAtom(environmentId))) {
        const refs = grouped.get(thread.projectId);
        const ref = { environmentId, threadId: thread.id };
        if (refs === undefined) {
          grouped.set(thread.projectId, [ref]);
        } else {
          refs.push(ref);
        }
      }
      if (grouped.size === 0) {
        previous = EMPTY_THREAD_REFS_BY_PROJECT;
        return previous;
      }
      const next = new Map<ProjectId, ReadonlyArray<ScopedThreadRef>>();
      for (const [projectId, refs] of grouped) {
        const previousRefs = previous.get(projectId);
        next.set(
          projectId,
          previousRefs !== undefined && threadRefsEqual(previousRefs, refs) ? previousRefs : refs,
        );
      }
      const previousProjectIds = [...previous.keys()];
      if (
        next.size === previous.size &&
        [...next].every(
          ([projectId, refs], index) =>
            previousProjectIds[index] === projectId && previous.get(projectId) === refs,
        )
      ) {
        return previous;
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-thread-refs-by-project:${environmentId}`));
  });

  const threadShellAtomFamily = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    return Atom.make((get) => {
      const source = get(environmentThreadIndexAtom(ref.environmentId)).get(ref.threadId) ?? null;
      return source === null ? null : scopedThread(ref.environmentId, source);
    }).pipe(Atom.withLabel(`environment-thread-shell:${key}`));
  });

  // Child questions are hidden with their sidebar rows. Read their shell summaries,
  // without subscribing to every child transcript.
  const childThreadInputsAtomFamily = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    let previous: ReadonlyArray<EnvironmentThreadShell> = [];
    return Atom.make((get) => {
      const children = new Map<ThreadId, OrchestrationV2ThreadShell[]>();
      for (const thread of get(environmentThreadsAtom(ref.environmentId))) {
        const parent = thread.lineage.parentThreadId;
        if (parent === null || thread.lineage.relationshipToParent !== "subagent") continue;
        const siblings = children.get(parent);
        if (siblings) siblings.push(thread);
        else children.set(parent, [thread]);
      }
      const seen = new Set<ThreadId>([ref.threadId]);
      const pending = [ref.threadId];
      const next: EnvironmentThreadShell[] = [];
      for (const parent of pending) {
        for (const child of children.get(parent) ?? []) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          pending.push(child.id);
          if (
            child.pendingRuntimeRequest?.kind === "user_input" &&
            !isProviderNativeSubagentThread(child)
          ) {
            next.push(scopedThread(ref.environmentId, child));
          }
        }
      }
      // Indicators read only ids and titles, so other shell updates keep the old array.
      if (
        previous.length === next.length &&
        previous.every(
          (thread, index) => thread.id === next[index]?.id && thread.title === next[index]?.title,
        )
      ) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-child-thread-inputs:${key}`));
  });

  const threadShellsForProjectRefsAtomFamily = Atom.family((key: string) => {
    const projectRefs = parseProjectRefCollectionKey(key);
    let previous: ReadonlyArray<EnvironmentThreadShell> = [];
    return Atom.make((get) => {
      const next: EnvironmentThreadShell[] = [];
      const seen = new Set<string>();
      const hidden = get(hiddenThreadKeysAtom);
      for (const projectRef of projectRefs) {
        const refs =
          get(environmentThreadRefsByProjectAtom(projectRef.environmentId)).get(
            projectRef.projectId,
          ) ?? EMPTY_SCOPED_THREAD_REFS;
        if (refs.length === 0) continue;
        const threads = get(environmentThreadIndexAtom(projectRef.environmentId));
        for (const ref of refs) {
          const key = threadKey(ref);
          if (seen.has(key) || hidden.has(key)) {
            continue;
          }
          seen.add(key);
          const thread = threads.get(ref.threadId);
          if (thread !== undefined) {
            next.push(scopedThread(ref.environmentId, thread));
          }
        }
      }
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-thread-shells-for-projects:${key}`));
  });

  let previousThreadRefs: ReadonlyArray<ScopedThreadRef> = [];
  const threadRefsAtom = Atom.make((get) => {
    const refs: ScopedThreadRef[] = [];
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      refs.push(...get(environmentThreadRefsAtom(environmentId)));
    }
    if (threadRefsEqual(previousThreadRefs, refs)) {
      return previousThreadRefs;
    }
    previousThreadRefs = refs;
    return refs;
  }).pipe(Atom.withLabel("environment-thread-refs"));

  let previousThreadShells: ReadonlyArray<EnvironmentThreadShell> = [];
  const threadShellsAtom = Atom.make((get) => {
    const next: EnvironmentThreadShell[] = [];
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      for (const thread of get(environmentThreadsAtom(environmentId))) {
        next.push(scopedThread(environmentId, thread));
      }
    }
    if (arrayElementsEqual(previousThreadShells, next)) {
      return previousThreadShells;
    }
    previousThreadShells = next;
    return previousThreadShells;
  }).pipe(Atom.withLabel("environment-thread-shell-list"));

  // Point reads and threadShellsAtom stay complete, so code that asks whether a thread
  // exists (outboxes, drafts, removals) never mistakes a hidden thread for a missing one.
  let previousHiddenThreadKeys: ReadonlySet<string> = NO_HIDDEN_THREADS;
  const hiddenThreadKeysAtom = Atom.make((get) => {
    const hiddenThreadTagsAtom = input.hiddenThreadTagsAtom;
    if (hiddenThreadTagsAtom === undefined) return NO_HIDDEN_THREADS;
    const environments = Array.from(
      enabledEnvironmentIds(get(input.catalogValueAtom)),
      (environmentId) => ({ environmentId, hiddenTags: get(hiddenThreadTagsAtom(environmentId)) }),
    );
    // Read shells only while some environment hides tags, so streaming ticks cost nothing otherwise.
    if (!environments.some((environment) => environment.hiddenTags !== null)) {
      previousHiddenThreadKeys = NO_HIDDEN_THREADS;
      return NO_HIDDEN_THREADS;
    }
    const next = hiddenThreadKeys(
      environments.map((environment) => ({
        ...environment,
        threads: get(environmentThreadsAtom(environment.environmentId)),
      })),
    );
    if (
      next.size === previousHiddenThreadKeys.size &&
      [...next].every((key) => previousHiddenThreadKeys.has(key))
    ) {
      return previousHiddenThreadKeys;
    }
    previousHiddenThreadKeys = next;
    return next;
  }).pipe(Atom.withLabel("environment-hidden-thread-keys"));

  /** threadShellsAtom without the threads the tag filter hides, for lists and palettes. */
  let previousVisibleThreadShells: ReadonlyArray<EnvironmentThreadShell> = [];
  const visibleThreadShellsAtom = Atom.make((get) => {
    const threads = get(threadShellsAtom);
    const hidden = get(hiddenThreadKeysAtom);
    if (hidden.size === 0) return threads;
    const next = threads.filter(
      (thread) =>
        !hidden.has(threadKey({ environmentId: thread.environmentId, threadId: thread.id })),
    );
    if (arrayElementsEqual(previousVisibleThreadShells, next)) return previousVisibleThreadShells;
    previousVisibleThreadShells = next;
    return next;
  }).pipe(Atom.withLabel("environment-visible-thread-shell-list"));

  let previousNavigationShells: ReadonlyArray<EnvironmentThreadShell> = [];
  const navigationThreadShellsAtom = Atom.make((get) => {
    const next: EnvironmentThreadShell[] = [];
    const hidden = get(hiddenThreadKeysAtom);
    for (const environmentId of enabledEnvironmentIds(get(input.catalogValueAtom))) {
      for (const thread of get(environmentThreadsAtom(environmentId))) {
        if (
          thread.archivedAt !== null ||
          thread.lineage.relationshipToParent === "subagent" ||
          hidden.has(threadKey({ environmentId, threadId: thread.id }))
        )
          continue;
        next.push(scopedThread(environmentId, thread));
      }
    }
    if (arrayElementsEqual(previousNavigationShells, next)) return previousNavigationShells;
    previousNavigationShells = next;
    return next;
  }).pipe(Atom.withLabel("environment-navigation-thread-shells"));

  return {
    environmentThreadsAtom,
    environmentThreadIndexAtom,
    environmentThreadRefsAtom,
    environmentThreadRefsByProjectAtom,
    threadRefsAtom,
    threadShellsAtom,
    visibleThreadShellsAtom,
    hiddenThreadKeysAtom,
    navigationThreadShellsAtom,
    threadShellsForProjectRefsAtom: (refs: ReadonlyArray<ScopedProjectRef>) =>
      threadShellsForProjectRefsAtomFamily(projectRefCollectionKey(refs)),
    threadShellAtom: (ref: ScopedThreadRef) => threadShellAtomFamily(threadKey(ref)),
    childThreadInputsAtom: (ref: ScopedThreadRef) => childThreadInputsAtomFamily(threadKey(ref)),
  };
}
