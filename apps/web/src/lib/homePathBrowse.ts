import type { EnvironmentId, FilesystemBrowseResult } from "@t3tools/contracts";
import { fileBasename, workspaceRelativeFilePath } from "@t3tools/shared/path";
import { useMemo } from "react";

import type { ComposerCommandItem } from "../components/chat/ComposerCommandMenu";
import { useServerConfigs } from "../state/entities";
import { filesystemEnvironment, useFilesystemReadAccess } from "../state/filesystem";
import { useDebouncedValue } from "../state/queries";
import { useEnvironmentQuery } from "../state/query";

const HOME_BROWSE_LIMIT = 100;
const HOME_BROWSE_DEBOUNCE_MS = 80;
const EMPTY_ITEMS: ComposerCommandItem[] = [];

/**
 * Whether a composer working in `cwd` is on the mainland: the Scratch project,
 * where `@` browses the machine from `~` instead of searching a workspace.
 */
export function useBrowsesHome(environmentId: EnvironmentId | null, cwd: string | null): boolean {
  const configs = useServerConfigs();
  const scratchRoot =
    environmentId === null ? null : (configs.get(environmentId)?.scratchWorkspaceRoot ?? null);
  return cwd !== null && workspaceRelativeFilePath(cwd, scratchRoot) !== null;
}

/**
 * The path an `@` query browses, read from `~`: `@` lists `~/`, `@Doc` and
 * `@~/Doc` match in `~`, and `@/` starts at the root. `folder` is the typed
 * folder part, kept as typed so opening a folder extends what the user wrote.
 */
export function homeBrowseTarget(query: string): {
  readonly partialPath: string;
  readonly folder: string;
} {
  const partialPath =
    query.startsWith("/") || query === "~" || query.startsWith("~/")
      ? query
      : `~/${query.replace(/^~/, "")}`;
  const folder =
    partialPath === "~" ? "~/" : partialPath.slice(0, partialPath.lastIndexOf("/") + 1);
  return { partialPath, folder };
}

/**
 * Menu items for one listing: folders open (`browseTo`), files insert. Once a
 * folder is typed in full (`~/Photos/`), it leads as an item that inserts
 * the folder itself; home and the root are never worth mentioning.
 */
export function homeBrowseItems(
  target: ReturnType<typeof homeBrowseTarget>,
  result: FilesystemBrowseResult,
): ComposerCommandItem[] {
  const description = target.folder.length > 1 ? target.folder.slice(0, -1) : target.folder;
  const listsFolder = target.partialPath === target.folder;
  const self: ComposerCommandItem[] =
    listsFolder && target.folder !== "~/" && target.folder !== "/"
      ? [
          {
            id: `path:directory:${result.parentPath}:self`,
            type: "path",
            path: result.parentPath,
            pathKind: "directory",
            label: fileBasename(target.folder),
            description: "This folder",
          },
        ]
      : [];
  return [
    ...self,
    ...result.entries.map((entry): ComposerCommandItem => {
      const pathKind = entry.kind ?? "directory";
      return {
        id: `path:${pathKind}:${entry.fullPath}`,
        type: "path",
        path: entry.fullPath,
        pathKind,
        label: entry.name,
        description,
        ...(pathKind === "directory" ? { browseTo: `${target.folder}${entry.name}/` } : {}),
      };
    }),
  ];
}

/** `@` suggestions that walk the machine from `~`; null `query` is idle. */
export function useHomePathBrowse(input: {
  readonly environmentId: EnvironmentId | null;
  readonly query: string | null;
}) {
  const debouncedQuery = useDebouncedValue(input.query, HOME_BROWSE_DEBOUNCE_MS);
  const target = useMemo(
    () => (debouncedQuery === null ? null : homeBrowseTarget(debouncedQuery)),
    [debouncedQuery],
  );
  const fileAccess = useFilesystemReadAccess(input.environmentId);
  const result = useEnvironmentQuery(
    fileAccess.canReadFiles && input.environmentId !== null && target !== null
      ? filesystemEnvironment.browse({
          environmentId: input.environmentId,
          input: { partialPath: target.partialPath, includeFiles: true, limit: HOME_BROWSE_LIMIT },
        })
      : null,
  );
  const items = useMemo(
    () =>
      target === null || result.data === null ? EMPTY_ITEMS : homeBrowseItems(target, result.data),
    [result.data, target],
  );
  return {
    items,
    isPending:
      input.query !== null &&
      (input.query !== debouncedQuery || fileAccess.isPending || result.isPending),
  };
}
