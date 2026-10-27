import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";

import {
  useProjectEntriesQuery,
  useProjectFileQuery,
} from "~/components/files/projectFilesQueryState";
import { type PackageManifestFile, resolvePackageScripts } from "~/packageScripts";

/**
 * The scripts the worktree's root manifests declare (package.json, deno.json, composer.json).
 * Reads nothing while `cwd` is null, so callers pass it only while the list is shown.
 */
export function usePackageScripts(environmentId: EnvironmentId, cwd: string | null) {
  const listing = useProjectEntriesQuery(environmentId, cwd ?? "", "", cwd !== null);
  const rootFiles = useMemo(
    () =>
      new Set(
        (listing.data?.entries ?? [])
          .filter((entry) => entry.kind === "file")
          .map((entry) => entry.path),
      ),
    [listing.data],
  );
  const packageJson = useManifestContents(environmentId, cwd, "package.json", rootFiles);
  const denoJson = useManifestContents(environmentId, cwd, "deno.json", rootFiles);
  const denoJsonc = useManifestContents(environmentId, cwd, "deno.jsonc", rootFiles);
  const composerJson = useManifestContents(environmentId, cwd, "composer.json", rootFiles);
  return useMemo(
    () =>
      resolvePackageScripts(rootFiles, {
        "package.json": packageJson,
        "deno.json": denoJson,
        "deno.jsonc": denoJsonc,
        "composer.json": composerJson,
      }),
    [rootFiles, packageJson, denoJson, denoJsonc, composerJson],
  );
}

function useManifestContents(
  environmentId: EnvironmentId,
  cwd: string | null,
  file: PackageManifestFile,
  rootFiles: ReadonlySet<string>,
): string | null {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    file,
    cwd !== null && rootFiles.has(file),
  );
  return query.data && !query.data.truncated ? query.data.contents : null;
}
