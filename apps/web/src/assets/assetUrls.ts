import { useAtomValue } from "@effect/atom-react";
import {
  type AssetUrlState,
  assetUrlStateFromResult,
  EMPTY_ASSET_URL_ATOM,
  resolveAssetUrl,
} from "@t3tools/client-runtime/state/assets";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { AssetImageDimensions, AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo } from "react";

import { assetEnvironment } from "~/state/assets";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { usePreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

export { resolveAssetUrl, type AssetUrlState } from "@t3tools/client-runtime/state/assets";

export function useAssetUrlState(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): AssetUrlState {
  const fileAccess = useFilesystemReadAccess(environmentId);
  const canReadResource =
    fileAccess.canReadFiles ||
    (resource?._tag !== "workspace-file" &&
      resource?._tag !== "media-file" &&
      resource?._tag !== "draft-workspace-file");
  const preparedConnection = usePreparedConnection(environmentId);
  const result = useAtomValue(
    !canReadResource || environmentId === null || resource === null
      ? EMPTY_ASSET_URL_ATOM
      : assetEnvironment.createUrl({ environmentId, input: { resource } }),
  );
  if (!canReadResource) return { _tag: fileAccess.isPending ? "Loading" : "Failure" };
  return assetUrlStateFromResult(
    result,
    preparedConnection._tag === "Some" ? preparedConnection.value.httpBaseUrl : null,
  );
}

export function useAssetUrlRefresh(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): () => Promise<string | null> {
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const refresh = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  return useCallback(async () => {
    if (environmentId === null || resource === null || httpBaseUrl === null) return null;
    const result = await refresh({ environmentId, input: { resource } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return resolveAssetUrl(httpBaseUrl, result.value.relativeUrl);
  }, [environmentId, resource, refresh, httpBaseUrl]);
}

/** A resource's URL and, for raster images, the pixel size read from its header. */
export interface AssetUrlEntry {
  readonly url: string;
  readonly imageDimensions: AssetImageDimensions | undefined;
}

/**
 * One entry per resource: undefined while its URL is on the way, null when there is none
 * (no file access, no connection, or the server refused it).
 */
export function useAssetUrlEntries(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<AssetUrlEntry | null | undefined> {
  const preparedConnection = usePreparedConnection(environmentId);
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const allowedResources = useMemo(
    () =>
      canReadFiles
        ? resources
        : resources.filter(
            (resource) =>
              resource._tag !== "workspace-file" &&
              resource._tag !== "media-file" &&
              resource._tag !== "draft-workspace-file",
          ),
    [canReadFiles, resources],
  );
  const results = useAtomValue(
    assetEnvironment.createUrls({
      environmentId,
      resources: allowedResources,
    }),
  );
  return useMemo(() => {
    if (preparedConnection._tag === "None") return resources.map(() => null);
    let resultIndex = 0;
    return resources.map((resource) => {
      if (
        !canReadFiles &&
        (resource._tag === "workspace-file" ||
          resource._tag === "media-file" ||
          resource._tag === "draft-workspace-file")
      )
        return null;
      const result = results[resultIndex++];
      if (result === undefined || AsyncResult.isInitial(result)) return undefined;
      if (!AsyncResult.isSuccess(result)) return null;
      const url = resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
      return url === null ? null : { url, imageDimensions: result.value.imageDimensions };
    });
  }, [canReadFiles, preparedConnection, resources, results]);
}

export function useAssetUrls(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<string | null> {
  const entries = useAssetUrlEntries(environmentId, resources);
  return useMemo(() => entries.map((entry) => entry?.url ?? null), [entries]);
}
