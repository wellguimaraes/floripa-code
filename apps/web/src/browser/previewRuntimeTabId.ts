import type { ScopedThreadRef } from "@t3tools/contracts";

import { previewStateKey } from "~/previewStateStore";

/**
 * The server only guarantees preview tab ids are unique within one process.
 * Desktop resources live across every connected environment, so they need a
 * stronger identity that also changes when a server process restarts. Tabs
 * belong to a checkout, so every thread in it resolves the same identity.
 */
export function previewRuntimeTabId(
  threadRef: ScopedThreadRef,
  serverEpoch: string | null,
  tabId: string,
): string {
  return previewRuntimeTabIdForKey(
    threadRef.environmentId,
    previewStateKey(threadRef),
    serverEpoch,
    tabId,
  );
}

/** For a caller that already holds the preview state's key, such as the desktop host. */
export function previewRuntimeTabIdForKey(
  environmentId: string,
  stateKey: string,
  serverEpoch: string | null,
  tabId: string,
): string {
  return JSON.stringify([environmentId, stateKey, serverEpoch, tabId]);
}

export function isCurrentPreviewRuntimeTab(
  threadRef: ScopedThreadRef,
  serverEpoch: string | null,
  tabId: string,
  runtimeTabId: string,
): boolean {
  return previewRuntimeTabId(threadRef, serverEpoch, tabId) === runtimeTabId;
}
