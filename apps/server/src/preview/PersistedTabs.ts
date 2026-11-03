/**
 * Desktop browser tabs saved across server restarts, so an app update or
 * relaunch reopens the tabs the user had. Only the address survives: pages
 * reload, history starts fresh, and tab ids are reassigned because they are
 * a per-process sequence.
 */
import { PreviewSessionSnapshot } from "@t3tools/contracts";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import { newPreviewTabId } from "@t3tools/shared/preview";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

const PersistedTabsJson = Schema.fromJsonString(Schema.Array(PreviewSessionSnapshot));
const decodePersistedTabs = Schema.decodeUnknownEffect(PersistedTabsJson);
const encodePersistedTabs = Schema.encodeEffect(PersistedTabsJson);

/**
 * Server-runtime tabs live in the server's own browser and agent-owned tabs
 * belong to a provider session; neither outlives the process.
 */
export const isPersistableTab = (snapshot: PreviewSessionSnapshot): boolean =>
  snapshot.runtime !== "server" && snapshot.automationOwner === undefined;

/** The tab as it reopens: loading its last address under a fresh id. */
export const restoreTab = (snapshot: PreviewSessionSnapshot): PreviewSessionSnapshot => {
  const { reveal: _reveal, revealRequest: _revealRequest, ...rest } = snapshot;
  return {
    ...rest,
    tabId: newPreviewTabId(),
    navStatus:
      snapshot.navStatus._tag === "Idle"
        ? snapshot.navStatus
        : { _tag: "Loading", url: snapshot.navStatus.url, title: snapshot.navStatus.title },
    canGoBack: false,
    canGoForward: false,
  };
};

/** Saved tabs, or none when the file is missing or unreadable. */
export const readPersistedTabs = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(filePath))) return [];
    const tabs = yield* decodePersistedTabs(yield* fs.readFileString(filePath));
    return tabs.filter(isPersistableTab).map(restoreTab);
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("ignoring unreadable saved browser tabs", { filePath, cause }).pipe(
        Effect.as([] as ReadonlyArray<PreviewSessionSnapshot>),
      ),
    ),
  );

export const writePersistedTabs = (filePath: string, snapshots: Iterable<PreviewSessionSnapshot>) =>
  Effect.gen(function* () {
    const contents = yield* encodePersistedTabs([...snapshots].filter(isPersistableTab));
    yield* writeFileStringAtomically({ filePath, contents });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to save browser tabs", { filePath, cause }),
    ),
  );
