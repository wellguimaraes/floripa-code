import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  ThreadId,
  ThreadMentionIntent,
} from "@t3tools/contracts";

const COMPOSER_THREAD_RESULT_LIMIT = 5;

export interface ComposerThreadCandidate {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly id: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface ComposerThreadItem {
  readonly id: string;
  readonly type: "thread";
  readonly thread: ScopedThreadRef;
  readonly label: string;
  readonly description: string;
  /** Set when the query named the intent (`@tell:`, `@look:`), so the row offers only that one. */
  readonly fixedIntent: ThreadMentionIntent | null;
}

const INTENT_PREFIX = /^(look|tell):/iu;

/**
 * Splits an `@` query into the thread intent it names and the title search. `@tell:fix`
 * asks for threads only, as tell mentions; a query without a prefix leaves the intent open.
 */
export function parseThreadMentionQuery(query: string): {
  readonly intent: ThreadMentionIntent | null;
  readonly titleQuery: string;
} {
  const prefix = INTENT_PREFIX.exec(query);
  if (!prefix) return { intent: null, titleQuery: query };
  return {
    intent: prefix[1]!.toLowerCase() as ThreadMentionIntent,
    titleQuery: query.slice(prefix[0].length),
  };
}

/** The label a thread mention chip reads, e.g. `@tell:Fix login`. */
export function threadMentionChipLabel(intent: ThreadMentionIntent, title: string): string {
  return `@${intent}:${title}`;
}

/**
 * Threads the `@` picker offers next to file paths: non-archived threads of the composer's
 * project, never the composer's own. A plain query must be typed so bare `@` stays a file
 * picker; after an intent prefix the most recent threads show even before a title is typed.
 */
export function matchComposerThreadItems(input: {
  shells: ReadonlyArray<ComposerThreadCandidate>;
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  excludeThreadId: ThreadId | null;
  query: string;
}): ComposerThreadItem[] {
  if (input.projectId === null) return [];
  const { intent, titleQuery } = parseThreadMentionQuery(input.query);
  const query = titleQuery.trim().toLowerCase();
  if (intent === null && query.length === 0) return [];
  return input.shells
    .filter(
      (shell) =>
        shell.environmentId === input.environmentId &&
        shell.projectId === input.projectId &&
        shell.id !== input.excludeThreadId &&
        shell.archivedAt === null &&
        shell.title.toLowerCase().includes(query),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, COMPOSER_THREAD_RESULT_LIMIT)
    .map((shell) => ({
      id: `thread:${shell.environmentId}:${shell.id}`,
      type: "thread",
      thread: { environmentId: shell.environmentId, threadId: shell.id },
      label: shell.title,
      description: "Thread",
      fixedIntent: intent,
    }));
}
