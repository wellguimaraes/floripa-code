// Enough hits to look past same-named neighbours (`ChatView.test.tsx`) without
// asking for a full listing on a single click.
export const WORKSPACE_BASENAME_LOOKUP_LIMIT = 25;

// One counter for every caller: they all open the same panel, so the newest
// click wins regardless of which one started the lookup.
let latestLookupSequence = 0;

/** Call the returned predicate when the search settles; false means a later click superseded it. */
export function claimWorkspaceBasenameLookup(): () => boolean {
  latestLookupSequence += 1;
  const claimed = latestLookupSequence;
  return () => claimed === latestLookupSequence;
}

export interface WorkspaceEntryCandidate {
  readonly path: string;
  readonly kind: "file" | "directory";
}

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

/**
 * Relative paths an agent writes may not start at the workspace root: a bare name
 * (`design.md`) or a path from inside a package (`src/specs/api.yaml` for
 * `frontend/api-client/src/specs/api.yaml`). Explicitly anchored paths open as written.
 */
export function needsWorkspacePathLookup(relativePath: string): boolean {
  const trimmed = relativePath.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes("\\") &&
    !/^(?:\/|~|\.{1,2}(?:\/|$)|[A-Za-z]:)/.test(trimmed)
  );
}

/** The indexed file a relative path names: the path itself, else the one file it ends. */
export function pickWorkspacePathMatch(
  relativePath: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const target = relativePath.trim();
  if (!target) return null;
  const files = entries.filter((entry) => entry.kind === "file");
  if (target.includes("/")) {
    if (files.some((entry) => entry.path === target)) return target;
    // Two packages with the same `src/index.ts` have no right answer.
    const nested = files.filter((entry) => entry.path.endsWith(`/${target}`));
    return nested.length === 1 ? (nested[0]?.path ?? null) : null;
  }
  const exact = files.find((entry) => basenameOfPath(entry.path) === target);
  if (exact) return exact.path;
  // Folded matching covers casing that drifted from disk, but `FOO.ts` against
  // both `Foo.ts` and `foo.ts` has no right answer, so it resolves to nothing
  // rather than opening whichever the index ranked first.
  const folded = target.toLowerCase();
  const foldedMatches = files.filter(
    (entry) => basenameOfPath(entry.path).toLowerCase() === folded,
  );
  return foldedMatches.length === 1 ? (foldedMatches[0]?.path ?? null) : null;
}
