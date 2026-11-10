import {
  archivedThreadFamilies,
  archivedThreadSortTime,
  type ArchivedSnapshotEntry,
} from "@t3tools/client-runtime/state/threads";
import {
  scopeProject,
  scopeThreadShell,
  type EnvironmentProject,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ArchivedThreadSortOrder, EnvironmentId } from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { scopedProjectKey } from "../../lib/scopedEntities";

export interface ArchivedThreadSort {
  /** What the list orders by. */
  readonly by: ArchivedThreadSortOrder;
  readonly direction: "newest" | "oldest";
}

export const DEFAULT_ARCHIVED_THREAD_SORT: ArchivedThreadSort = {
  by: "archived_at",
  direction: "newest",
};

/** One row: an archived agent, or one of its archived subagents nested under it. */
export interface ArchivedThreadRowEntry {
  readonly thread: EnvironmentThreadShell;
  readonly nested: boolean;
  /** How many archived subagents sit under it; 0 for a nested row. */
  readonly subagentCount: number;
}

export interface ArchivedThreadGroup {
  readonly key: string;
  readonly project: EnvironmentProject;
  readonly rows: ReadonlyArray<ArchivedThreadRowEntry>;
}

function sortTimestamp(thread: EnvironmentThreadShell, by: ArchivedThreadSortOrder): number {
  const timestamp = Date.parse(archivedThreadSortTime(thread, by));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function matchesQuery(value: string | null, query: string): boolean {
  return value?.toLocaleLowerCase().includes(query) ?? false;
}

export function buildArchivedThreadGroups(input: {
  readonly snapshots: ReadonlyArray<ArchivedSnapshotEntry>;
  readonly environmentLabels: Readonly<Record<string, string>>;
  readonly environmentId: EnvironmentId | null;
  readonly searchQuery: string;
  readonly sort: ArchivedThreadSort;
}): ReadonlyArray<ArchivedThreadGroup> {
  const query = input.searchQuery.trim().toLocaleLowerCase();
  const groups: ArchivedThreadGroup[] = [];

  for (const entry of input.snapshots) {
    if (input.environmentId !== null && input.environmentId !== entry.environmentId) {
      continue;
    }

    const environmentLabel = input.environmentLabels[entry.environmentId] ?? null;
    const threadsByProjectId = new Map<string, EnvironmentThreadShell[]>();
    for (const thread of entry.snapshot.threads) {
      if (thread.archivedAt === null) {
        continue;
      }
      const threads = threadsByProjectId.get(thread.projectId) ?? [];
      threads.push(scopeThreadShell(entry.environmentId, thread));
      threadsByProjectId.set(thread.projectId, threads);
    }

    for (const rawProject of entry.snapshot.projects) {
      const project = scopeProject(entry.environmentId, rawProject);
      const projectThreads = threadsByProjectId.get(project.id) ?? [];
      const groupMatches =
        query.length === 0 ||
        matchesQuery(project.title, query) ||
        matchesQuery(project.workspaceRoot, query) ||
        matchesQuery(environmentLabel, query);
      const matchingThreads = groupMatches
        ? projectThreads
        : projectThreads.filter(
            (thread) => matchesQuery(thread.title, query) || matchesQuery(thread.branch, query),
          );

      if (matchingThreads.length === 0) {
        continue;
      }

      const families = archivedThreadFamilies(matchingThreads, input.sort.by, {
        oldestFirst: input.sort.direction === "oldest",
      });
      groups.push({
        key: scopedProjectKey(project.environmentId, project.id),
        project,
        rows: families.flatMap((family) => [
          { thread: family.thread, nested: false, subagentCount: family.subagents.length },
          ...family.subagents.map((thread) => ({ thread, nested: true, subagentCount: 0 })),
        ]),
      });
    }
  }

  const timestampOrder =
    input.sort.direction === "newest" ? Order.flip(Order.Number) : Order.Number;
  return Arr.sort(
    groups,
    Order.mapInput(
      Order.Struct({ timestamp: timestampOrder, title: Order.String, key: Order.String }),
      (group: ArchivedThreadGroup) => ({
        timestamp: group.rows[0] ? sortTimestamp(group.rows[0].thread, input.sort.by) : 0,
        title: group.project.title,
        key: group.key,
      }),
    ),
  );
}
