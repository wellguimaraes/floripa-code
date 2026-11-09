import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";

import { threadKey } from "./entities.ts";

type FilterableThread = Pick<OrchestrationV2ThreadShell, "id" | "tags"> & {
  readonly lineage: { readonly parentThreadId: ThreadId | null };
};

export interface TagFilteredEnvironment {
  readonly environmentId: EnvironmentId;
  readonly threads: ReadonlyArray<FilterableThread>;
  /** Tags this environment hides, or null while its filter is off. */
  readonly hiddenTags: ReadonlyArray<string> | null;
}

export const NO_HIDDEN_THREADS: ReadonlySet<string> = new Set();

function hasHiddenTag(
  tags: ReadonlyArray<string> | undefined,
  hiddenTags: ReadonlyArray<string> | null,
): boolean {
  return hiddenTags?.some((tag) => tags?.includes(tag) === true) === true;
}

/**
 * Keys of threads the tag filter hides. A child thread (subagent, fork, side chat) follows its
 * loaded parent, so tagging a parent hides its whole tree. A child whose parent is not loaded is
 * judged by its own tags.
 */
export function hiddenThreadKeys(
  environments: ReadonlyArray<TagFilteredEnvironment>,
): ReadonlySet<string> {
  if (!environments.some((environment) => environment.hiddenTags !== null)) {
    return NO_HIDDEN_THREADS;
  }
  const byKey = new Map<
    string,
    { thread: FilterableThread; environment: TagFilteredEnvironment }
  >();
  for (const environment of environments) {
    for (const thread of environment.threads) {
      byKey.set(threadKey({ environmentId: environment.environmentId, threadId: thread.id }), {
        thread,
        environment,
      });
    }
  }
  const hiddenByKey = new Map<string, boolean>();
  const isHidden = (key: string): boolean => {
    const known = hiddenByKey.get(key);
    if (known !== undefined) return known;
    const entry = byKey.get(key);
    if (entry === undefined) return false;
    const { thread, environment } = entry;
    const parentId = thread.lineage.parentThreadId;
    const parentKey =
      parentId === null
        ? null
        : threadKey({ environmentId: environment.environmentId, threadId: parentId });
    const ownHidden = hasHiddenTag(thread.tags, environment.hiddenTags);
    if (parentKey === null || !byKey.has(parentKey)) {
      hiddenByKey.set(key, ownHidden);
      return ownHidden;
    }
    // Seed before following the parent so a malformed cycle ends visible.
    hiddenByKey.set(key, false);
    const hidden = ownHidden || isHidden(parentKey);
    hiddenByKey.set(key, hidden);
    return hidden;
  };
  const hidden = new Set<string>();
  for (const key of byKey.keys()) {
    if (isHidden(key)) hidden.add(key);
  }
  return hidden.size === 0 ? NO_HIDDEN_THREADS : hidden;
}
