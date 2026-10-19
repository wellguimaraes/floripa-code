/**
 * Worktree-scoped right-panel surface state.
 *
 * Every thread working in the same checkout shares one panel: its surfaces,
 * the selected type and tab, and whether the chat is collapsed. Actions still
 * take the caller's thread ref; `rightPanelKey` maps it to the checkout, and
 * falls back to the thread itself until the thread reaches this client.
 *
 * This is intentionally a shallow workspace model: it owns an ordered set of
 * surface descriptors and the active surface, while each feature continues to
 * own its durable resource state. Browser surfaces point at preview tab ids,
 * terminal surfaces point at terminal session ids, file surfaces point at
 * workspace paths, and diff/files remain singleton surfaces.
 */
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useClosedViewStore } from "./closedViewStore";
import { resolveStorage } from "./lib/storage";
import type { ThreadPanelPresentation } from "./rightPanelLayout";
import type { ChatFileAttachment } from "./types";

const RIGHT_PANEL_KINDS = [
  "diff",
  "files",
  "file",
  "preview",
  "device",
  "terminal",
  "pull-request",
  "pull-requests",
] as const;
export type RightPanelKind = (typeof RIGHT_PANEL_KINDS)[number];

export interface DeviceTabTarget {
  hostId: string;
  deviceId: string;
  platform: "ios" | "android";
  name: string;
}

export type RightPanelSurface =
  | { id: `browser:${string}`; kind: "preview"; resourceId: string }
  | { id: "browser:new"; kind: "preview"; resourceId: null }
  | { id: "device" | `device:${string}`; kind: "device"; target?: DeviceTabTarget; title?: string }
  | {
      id: `terminal:${string}`;
      kind: "terminal";
      resourceId: string;
      terminalIds: string[];
      activeTerminalId: string;
      splitDirection?: "horizontal" | "vertical";
    }
  | { id: "diff"; kind: "diff" }
  | { id: "files"; kind: "files" }
  | {
      id: `file:${string}` | `attachment:${string}`;
      kind: "file";
      /** Workspace-relative, or absolute for a host file outside the workspace. */
      relativePath: string;
      revealLine: number | null;
      revealRequestId: number;
      /** Present when the file lives in the thread's attachment store rather
          than at a workspace or host path. */
      attachment?: ChatFileAttachment;
    }
  | {
      /**
       * A change request opened beside a thread or in the pull-request list's shared panel.
       * The reference lives in the id so several pull requests can remain open as peer tabs.
       */
      id: `pull-request:${string}`;
      kind: "pull-request";
      /**
       * Which server the change request was read from. The list spans every connected one, so
       * two of them can hold the same project id; a panel beside a thread leaves this out and
       * takes the environment from its own ref.
       */
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
    }
  /** The thread's linked pull requests, one singleton tab beside any number of `pull-request` tabs. */
  | { id: "pull-requests"; kind: "pull-requests" };

/**
 * What the type rail switches between. Each surface kind belongs to one type;
 * a type shows its surfaces as tabs.
 */
export const RIGHT_PANEL_SURFACE_TYPES = [
  "terminal",
  "preview",
  "pull-request",
  "device",
  "files",
  "diff",
] as const;
export type RightPanelSurfaceType = (typeof RIGHT_PANEL_SURFACE_TYPES)[number];

export function rightPanelSurfaceType(kind: RightPanelKind): RightPanelSurfaceType {
  switch (kind) {
    case "file":
      return "files";
    case "pull-requests":
      return "pull-request";
    default:
      return kind;
  }
}

const RIGHT_PANEL_STORAGE_KEY = "t3code:right-panel-state:v2";
// v9 removed the "plan" surface kind (plans render inline in the transcript).
// v10 keys pull-request surfaces by reference instead of a singleton tab.
// v11 stops persisting the pull-request list's shared panel, so a restart opens the page fresh.
// v12 adds the device surface.
// v14 removes the agents surface; lineage lives in the thread title bar.
// v15 keys panels by checkout instead of thread; per-thread layouts are dropped.
const RIGHT_PANEL_STORAGE_VERSION = 15;

/** A fixed workspace-level ref: each PR surface carries its own real environment. */
export const PULL_REQUESTS_PANEL_REF = scopeThreadRef(
  EnvironmentId.make("pull-requests-panel"),
  ThreadId.make("pull-requests-panel"),
);

/**
 * The pull-request list's shared panel is session
 * state: reopening the app should show the list, not last session's tabs and detail fetches.
 */
const isPullRequestsPanelKey = (threadKey: string) => threadKey.endsWith(":pull-requests-panel");

let resolveScopedPanelKey: (ref: ScopedThreadRef) => string | null = () => null;

/** Installed once at startup so the store stays free of entity lookups. */
export function setRightPanelScopeResolver(
  resolver: (ref: ScopedThreadRef) => string | null,
): void {
  resolveScopedPanelKey = resolver;
}

/**
 * The thread each panel was last acted on from, so a closed tab can be
 * reopened from the thread that closed it.
 */
const lastThreadRefByPanelKey = new Map<string, ScopedThreadRef>();

export function rightPanelKey(ref: ScopedThreadRef): string {
  const threadKey = scopedThreadKey(ref);
  const key = isPullRequestsPanelKey(threadKey)
    ? threadKey
    : (resolveScopedPanelKey(ref) ?? threadKey);
  lastThreadRefByPanelKey.set(key, ref);
  return key;
}

export interface ThreadRightPanelState {
  isOpen: boolean;
  activeSurfaceId: string | null;
  /**
   * The type shown when no surface is active, such as a type whose last tab
   * was closed. A selected surface's own type wins.
   */
  activeType?: RightPanelSurfaceType;
  /** Each type's last selected tab, restored when the type is picked again. */
  activeSurfaceIdByType?: Partial<Record<RightPanelSurfaceType, string>>;
  surfaces: RightPanelSurface[];
  dismissedDeviceSurfaceIds?: string[];
  /** Kept with the thread so the layout survives a ChatView remount or a reload. */
  maximized?: true;
}

export interface ThreadPanelVisibility {
  inlineOpen: boolean;
  popoverOpen: boolean;
}

interface RightPanelStoreState {
  /** Keyed by `rightPanelKey`: the thread's checkout, or the thread before it resolves. */
  byPanelKey: Record<string, ThreadRightPanelState>;
  /**
   * A thread whose right panel should open maximized the next time it shows,
   * such as one started for a link the OS opened. Its view consumes it once.
   */
  pendingMaximizeThreadKey: string | null;
  requestMaximize: (ref: ScopedThreadRef) => void;
  consumeMaximizeRequest: (ref: ScopedThreadRef) => boolean;
  threadPanelVisibilityByThreadKey: Record<string, ThreadPanelVisibility>;
  /** Session-only count of user panel choices per panel. Automatic updates do not advance it. */
  userActionRevisionByPanelKey: Record<string, number>;
  closeRevisionByPanelKey: Record<string, number>;
  getUserActionRevision: (ref: ScopedThreadRef) => number;
  /**
   * Open a surface on behalf of the app, not the user. Refused when the user
   * made a panel choice after `expectedUserActionRevision` was read.
   */
  openProactive: (
    ref: ScopedThreadRef,
    surface: Extract<RightPanelSurface, { kind: "diff" | "pull-request" | "pull-requests" }>,
    expectedUserActionRevision: number,
  ) => boolean;
  open: (
    ref: ScopedThreadRef,
    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request">,
  ) => void;
  openDevice: (ref: ScopedThreadRef, target: DeviceTabTarget, automatic?: boolean) => void;
  renameDevice: (ref: ScopedThreadRef, surfaceId: string, title: string) => void;
  openBrowser: (ref: ScopedThreadRef, tabId: string | null) => void;
  openFile: (ref: ScopedThreadRef, relativePath: string, line?: number) => void;
  openAttachment: (ref: ScopedThreadRef, attachment: ChatFileAttachment) => void;
  openPullRequest: (
    ref: ScopedThreadRef,
    target: {
      environmentId?: string;
      projectId: string;
      host?: string;
      repository: string;
      number: number;
      url?: string;
    },
  ) => void;
  openTerminal: (ref: ScopedThreadRef, terminalId: string) => void;
  splitTerminal: (
    ref: ScopedThreadRef,
    surfaceId: string,
    terminalId: string,
    direction?: "horizontal" | "vertical",
  ) => void;
  activateTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  closeTerminal: (ref: ScopedThreadRef, surfaceId: string, terminalId: string) => void;
  activateSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  /** Shows a type, restoring its last selected tab, or its empty state when it has none. */
  activateType: (ref: ScopedThreadRef, type: RightPanelSurfaceType) => void;
  closeSurface: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeOtherSurfaces: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeSurfacesToRight: (ref: ScopedThreadRef, surfaceId: string) => void;
  closeAllSurfaces: (ref: ScopedThreadRef) => void;
  moveSurface: (ref: ScopedThreadRef, surfaceId: string, toIndex: number) => void;
  reconcileBrowserSurfaces: (
    ref: ScopedThreadRef,
    tabIds: readonly string[],
    hiddenTabIds?: ReadonlySet<string>,
  ) => void;
  reconcileFileSurfaces: (ref: ScopedThreadRef, workspaceAvailable: boolean) => void;
  show: (ref: ScopedThreadRef) => void;
  close: (ref: ScopedThreadRef) => void;
  setMaximized: (ref: ScopedThreadRef, maximized: boolean) => void;
  toggleVisibility: (ref: ScopedThreadRef) => void;
  toggle: (
    ref: ScopedThreadRef,
    kind: Exclude<RightPanelKind, "file" | "terminal" | "pull-request">,
  ) => void;
  setThreadPanelOpen: (
    ref: ScopedThreadRef,
    presentation: ThreadPanelPresentation,
    open: boolean,
  ) => void;
  toggleThreadPanel: (ref: ScopedThreadRef, presentation: ThreadPanelPresentation) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

const EMPTY_THREAD_STATE: ThreadRightPanelState = {
  isOpen: false,
  activeSurfaceId: null,
  surfaces: [],
};

const DEFAULT_THREAD_PANEL_VISIBILITY: ThreadPanelVisibility = {
  inlineOpen: true,
  popoverOpen: false,
};

const singletonSurface = (
  kind: Exclude<RightPanelKind, "file" | "preview" | "terminal" | "pull-request">,
): RightPanelSurface => {
  switch (kind) {
    case "diff":
      return { id: "diff", kind };
    case "files":
      return { id: "files", kind };
    case "pull-requests":
      return { id: "pull-requests", kind };
    case "device":
      return { id: "device", kind };
  }
};

const browserSurface = (tabId: string | null): RightPanelSurface =>
  tabId
    ? { id: `browser:${tabId}`, kind: "preview", resourceId: tabId }
    : { id: "browser:new", kind: "preview", resourceId: null };

const fileSurface = (
  relativePath: string,
  revealLine: number | null,
  revealRequestId: number,
): RightPanelSurface => ({
  id: `file:${relativePath}`,
  kind: "file",
  relativePath,
  revealLine,
  revealRequestId,
});

const attachmentSurface = (attachment: ChatFileAttachment): RightPanelSurface => ({
  id: `attachment:${attachment.id}`,
  kind: "file",
  relativePath: attachment.name,
  revealLine: null,
  revealRequestId: 0,
  attachment,
});

const terminalSurface = (terminalId: string): RightPanelSurface => ({
  id: `terminal:${terminalId}`,
  kind: "terminal",
  resourceId: terminalId,
  terminalIds: [terminalId],
  activeTerminalId: terminalId,
});

export type PullRequestSurface = Extract<RightPanelSurface, { kind: "pull-request" }>;

export function pullRequestSurfaceId(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
}): PullRequestSurface["id"] {
  // The environment leads the id where there is one, so the same change request read from two
  // servers is two tabs rather than one tab that changes its mind about which server it is on.
  const scope =
    target.environmentId === undefined ? "" : `${encodeURIComponent(target.environmentId)}:`;
  const host = target.host === undefined ? "" : `${encodeURIComponent(target.host.toLowerCase())}:`;
  return `pull-request:${scope}${encodeURIComponent(target.projectId)}:${host}${encodeURIComponent(target.repository)}:${target.number}`;
}

export function pullRequestSurface(target: {
  environmentId?: string;
  projectId: string;
  host?: string;
  repository: string;
  number: number;
  url?: string;
}): PullRequestSurface {
  return {
    id: pullRequestSurfaceId(target),
    kind: "pull-request",
    ...(target.environmentId === undefined ? {} : { environmentId: target.environmentId }),
    projectId: target.projectId,
    ...(typeof target.host === "string" ? { host: target.host.toLowerCase() } : {}),
    repository: target.repository,
    number: target.number,
    ...(typeof target.url === "string" ? { url: target.url } : {}),
  };
}

const upsertSurface = (
  current: ThreadRightPanelState,
  surface: RightPanelSurface,
  activate = true,
): ThreadRightPanelState => ({
  ...current,
  isOpen: true,
  surfaces: current.surfaces.some((entry) => entry.id === surface.id)
    ? current.surfaces
    : [...current.surfaces, surface],
  activeSurfaceId: activate ? surface.id : current.activeSurfaceId,
});

const isEmptyPanelState = (state: ThreadRightPanelState) =>
  !state.isOpen &&
  state.activeSurfaceId === null &&
  state.surfaces.length === 0 &&
  !state.dismissedDeviceSurfaceIds?.length &&
  state.maximized === undefined;

/** Keeps the active type and each type's last tab in step with the selected surface. */
const trackActiveType = (
  current: ThreadRightPanelState,
  next: ThreadRightPanelState,
): ThreadRightPanelState => {
  if (next.activeSurfaceId === null || next.activeSurfaceId === current.activeSurfaceId) {
    return next;
  }
  const surface = next.surfaces.find((entry) => entry.id === next.activeSurfaceId);
  if (!surface) return next;
  const type = rightPanelSurfaceType(surface.kind);
  if (next.activeType === type && next.activeSurfaceIdByType?.[type] === surface.id) return next;
  return {
    ...next,
    activeType: type,
    activeSurfaceIdByType: { ...next.activeSurfaceIdByType, [type]: surface.id },
  };
};

/** The Files type never shows empty: with no file selected it shows the checkout's tree. */
const fallBackToFilesTree = (state: ThreadRightPanelState): ThreadRightPanelState => {
  if (!state.isOpen || state.activeType !== "files" || state.activeSurfaceId !== null) {
    return state;
  }
  return upsertSurface(state, singletonSurface("files"));
};

const updatePanelStateMap = (
  byPanelKey: Record<string, ThreadRightPanelState>,
  panelKey: string,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Record<string, ThreadRightPanelState> => {
  const current = byPanelKey[panelKey] ?? EMPTY_THREAD_STATE;
  const updated = updater(current);
  if (updated === current) return byPanelKey;
  const next = trackActiveType(current, fallBackToFilesTree(updated));
  if (isEmptyPanelState(next)) {
    if (!(panelKey in byPanelKey)) return byPanelKey;
    const { [panelKey]: _removed, ...rest } = byPanelKey;
    return rest;
  }
  return { ...byPanelKey, [panelKey]: next };
};

const updateThreadPanelVisibilityMap = (
  byThreadKey: Record<string, ThreadPanelVisibility>,
  threadKey: string,
  updater: (current: ThreadPanelVisibility) => ThreadPanelVisibility,
): Record<string, ThreadPanelVisibility> => {
  const current = byThreadKey[threadKey] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
  const next = updater(current);
  if (next.inlineOpen && !next.popoverOpen) {
    if (!(threadKey in byThreadKey)) return byThreadKey;
    const { [threadKey]: _removed, ...rest } = byThreadKey;
    return rest;
  }
  if (next === current) return byThreadKey;
  return { ...byThreadKey, [threadKey]: next };
};

type RightPanelStoreData = Pick<
  RightPanelStoreState,
  "byPanelKey" | "threadPanelVisibilityByThreadKey"
>;

/**
 * Applies a real right-panel mutation and its thread-panel transition atomically.
 * This is the only path real panel actions use, so visibility never has to be
 * reconciled after the fact in React. The details card stays per thread; the
 * panel itself is per checkout.
 */
const updatePanel = (
  state: RightPanelStoreData,
  ref: ScopedThreadRef,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): RightPanelStoreData => {
  const panelKey = rightPanelKey(ref);
  const threadKey = scopedThreadKey(ref);
  const current = state.byPanelKey[panelKey] ?? EMPTY_THREAD_STATE;
  const byPanelKey = updatePanelStateMap(state.byPanelKey, panelKey, updater);
  const next = byPanelKey[panelKey] ?? EMPTY_THREAD_STATE;
  let threadPanelVisibilityByThreadKey = state.threadPanelVisibilityByThreadKey;

  if (!current.isOpen && next.isOpen) {
    threadPanelVisibilityByThreadKey = updateThreadPanelVisibilityMap(
      threadPanelVisibilityByThreadKey,
      threadKey,
      (visibility) => (visibility.popoverOpen ? { ...visibility, popoverOpen: false } : visibility),
    );
  } else if (current.isOpen && !next.isOpen) {
    threadPanelVisibilityByThreadKey = updateThreadPanelVisibilityMap(
      threadPanelVisibilityByThreadKey,
      threadKey,
      (visibility) =>
        visibility.popoverOpen && !visibility.inlineOpen
          ? { ...visibility, inlineOpen: true }
          : visibility,
    );
  }

  return { byPanelKey, threadPanelVisibilityByThreadKey };
};

// Every store action is a user choice unless it goes through `automaticUpdate`.
// Only `openProactive` and resource reconciliation are automatic, so a new
// action counts as a user choice by default.
const automaticUpdate = (
  state: RightPanelStoreState,
  ref: ScopedThreadRef,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Partial<RightPanelStoreState> => ({
  ...updatePanel(state, ref, updater),
});

const userAction = (
  state: RightPanelStoreState,
  ref: ScopedThreadRef,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
  closesView = false,
): Partial<RightPanelStoreState> => {
  const panelKey = rightPanelKey(ref);
  return {
    ...updatePanel(state, ref, (current) => {
      const next = updater(current);
      if (next === current) return current;
      const removedDevices = current.surfaces.filter(
        (surface) =>
          surface.kind === "device" && !next.surfaces.some((entry) => entry.id === surface.id),
      );
      if (removedDevices.length === 0) return next;
      return {
        ...next,
        dismissedDeviceSurfaceIds: [
          ...new Set([
            ...(next.dismissedDeviceSurfaceIds ?? []),
            ...removedDevices.map((surface) => surface.id),
          ]),
        ],
      };
    }),
    userActionRevisionByPanelKey: {
      ...state.userActionRevisionByPanelKey,
      [panelKey]: (state.userActionRevisionByPanelKey[panelKey] ?? 0) + 1,
    },
    ...(closesView
      ? {
          closeRevisionByPanelKey: {
            ...state.closeRevisionByPanelKey,
            [panelKey]: (state.closeRevisionByPanelKey[panelKey] ?? 0) + 1,
          },
        }
      : {}),
  };
};

const closeAction = (
  state: RightPanelStoreState,
  ref: ScopedThreadRef,
  updater: (current: ThreadRightPanelState) => ThreadRightPanelState,
): Partial<RightPanelStoreState> => userAction(state, ref, updater, true);

/**
 * After closing the surface at `index`, select its nearest neighbour of the
 * same type. With none left the panel keeps showing that type, empty.
 */
const selectAfterRemoval = (
  current: ThreadRightPanelState,
  removed: RightPanelSurface,
  index: number,
  surfaces: RightPanelSurface[],
): Pick<ThreadRightPanelState, "activeSurfaceId" | "activeType"> => {
  if (current.activeSurfaceId !== removed.id) {
    return {
      activeSurfaceId: current.activeSurfaceId,
      ...(current.activeType ? { activeType: current.activeType } : {}),
    };
  }
  const type = rightPanelSurfaceType(removed.kind);
  const sameType = surfaces
    .map((surface, position) => ({ surface, position }))
    .filter(({ surface }) => rightPanelSurfaceType(surface.kind) === type);
  const fallback = sameType.find(({ position }) => position >= index) ?? sameType.at(-1) ?? null;
  return { activeSurfaceId: fallback?.surface.id ?? null, activeType: type };
};

function normalizeRevealLine(line: number | undefined): number | null {
  if (line === undefined || !Number.isFinite(line)) return null;
  return Math.max(1, Math.trunc(line));
}

/**
 * Panels were per thread before v15 and cannot be assigned to a checkout
 * without the thread list, so they start empty. The details-card choice is
 * still per thread and carries over.
 */
export function migratePersistedRightPanelState(persistedState: unknown): {
  byPanelKey: Record<string, ThreadRightPanelState>;
  threadPanelVisibilityByThreadKey: Record<string, ThreadPanelVisibility>;
} {
  if (!persistedState || typeof persistedState !== "object") {
    return { byPanelKey: {}, threadPanelVisibilityByThreadKey: {} };
  }
  const threadPanelVisibilityByThreadKey =
    "threadPanelVisibilityByThreadKey" in persistedState &&
    persistedState.threadPanelVisibilityByThreadKey &&
    typeof persistedState.threadPanelVisibilityByThreadKey === "object"
      ? Object.fromEntries(
          Object.entries(
            persistedState.threadPanelVisibilityByThreadKey as Record<string, unknown>,
          ).flatMap(([threadKey, value]) => {
            if (!value || typeof value !== "object" || !("inlineOpen" in value)) return [];
            return value.inlineOpen === false
              ? [[threadKey, { inlineOpen: false, popoverOpen: false }]]
              : [];
          }),
        )
      : {};
  return { byPanelKey: {}, threadPanelVisibilityByThreadKey };
}

export const useRightPanelStore = create<RightPanelStoreState>()(
  persist(
    (set, get) => ({
      byPanelKey: {},
      pendingMaximizeThreadKey: null,
      requestMaximize: (ref) => set({ pendingMaximizeThreadKey: scopedThreadKey(ref) }),
      consumeMaximizeRequest: (ref) => {
        if (get().pendingMaximizeThreadKey !== scopedThreadKey(ref)) return false;
        set({ pendingMaximizeThreadKey: null });
        return true;
      },
      threadPanelVisibilityByThreadKey: {},
      userActionRevisionByPanelKey: {},
      closeRevisionByPanelKey: {},
      getUserActionRevision: (ref) => get().userActionRevisionByPanelKey[rightPanelKey(ref)] ?? 0,
      openProactive: (ref, surface, expectedUserActionRevision) => {
        let opened = false;
        set((state) => {
          if (
            (state.userActionRevisionByPanelKey[rightPanelKey(ref)] ?? 0) !==
            expectedUserActionRevision
          ) {
            return state;
          }
          // A linked PR takes priority over a completed-turn diff. Manual actions
          // always apply, and later user choices reject both proactive requests.
          if (
            surface.kind === "diff" &&
            (selectActiveRightPanel(state.byPanelKey, ref) === "pull-request" ||
              selectActiveRightPanel(state.byPanelKey, ref) === "pull-requests")
          ) {
            return state;
          }
          opened = true;
          return automaticUpdate(state, ref, (current) => upsertSurface(current, surface));
        });
        return opened;
      },
      open: (ref, kind) =>
        set((state) =>
          userAction(state, ref, (current) => {
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      openDevice: (ref, target, automatic = false) =>
        set((state) =>
          (automatic ? automaticUpdate : userAction)(state, ref, (current) => {
            const id =
              `device:${encodeURIComponent(target.hostId)}:${encodeURIComponent(target.deviceId)}` as const;
            if (automatic && current.dismissedDeviceSurfaceIds?.includes(id)) return current;
            const surface: RightPanelSurface = { id, kind: "device", target };
            const existing = current.surfaces.find((entry) => entry.id === id);
            const surfaces = existing
              ? current.surfaces.filter((entry) => entry.id !== "device")
              : current.surfaces.map((entry) => (entry.id === "device" ? surface : entry));
            return upsertSurface(
              {
                ...current,
                surfaces,
                dismissedDeviceSurfaceIds: (current.dismissedDeviceSurfaceIds ?? []).filter(
                  (entry) => entry !== id,
                ),
              },
              existing ?? surface,
            );
          }),
        ),
      renameDevice: (ref, surfaceId, title) =>
        set((state) =>
          userAction(state, ref, (current) => ({
            ...current,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId && surface.kind === "device"
                ? { ...surface, title: title.trim() || surface.target?.name || "Device" }
                : surface,
            ),
          })),
        ),
      openBrowser: (ref, tabId) =>
        set((state) =>
          userAction(state, ref, (current) => {
            const surface = browserSurface(tabId);
            const withoutPlaceholder = tabId
              ? current.surfaces.filter((entry) => entry.id !== "browser:new")
              : current.surfaces;
            return upsertSurface({ ...current, surfaces: withoutPlaceholder }, surface);
          }),
        ),
      openPullRequest: (ref, target) =>
        set((state) =>
          userAction(state, ref, (current) => {
            const surface = pullRequestSurface(target);
            const next = upsertSurface(current, surface);
            return target.url
              ? {
                  ...next,
                  surfaces: next.surfaces.map((entry) =>
                    entry.id === surface.id ? surface : entry,
                  ),
                }
              : next;
          }),
        ),
      openFile: (ref, requestedPath, line) =>
        set((state) =>
          userAction(state, ref, (current) => {
            if (requestedPath === ".") {
              return upsertSurface(current, singletonSurface("files"));
            }
            // Workspace entry paths use '/', including on Windows.
            const relativePath = /^[A-Za-z]:\/+$/.test(requestedPath)
              ? requestedPath
              : requestedPath.replace(/\/+$/, "") || requestedPath;
            const surfaceId = `file:${relativePath}` as const;
            const existing = current.surfaces.find(
              (surface): surface is Extract<RightPanelSurface, { kind: "file" }> =>
                surface.id === surfaceId && surface.kind === "file",
            );
            const surface = fileSurface(
              relativePath,
              normalizeRevealLine(line),
              (existing?.revealRequestId ?? 0) + 1,
            );
            return {
              ...current,
              isOpen: true,
              activeSurfaceId: surface.id,
              surfaces: existing
                ? current.surfaces.map((entry) => (entry.id === surface.id ? surface : entry))
                : [...current.surfaces, surface],
            };
          }),
        ),
      openAttachment: (ref, attachment) =>
        set((state) =>
          userAction(state, ref, (current) =>
            upsertSurface(current, attachmentSurface(attachment)),
          ),
        ),
      openTerminal: (ref, terminalId) =>
        set((state) =>
          userAction(state, ref, (current) => upsertSurface(current, terminalSurface(terminalId))),
        ),
      splitTerminal: (ref, surfaceId, terminalId, direction = "horizontal") =>
        set((state) =>
          userAction(state, ref, (current) => ({
            ...current,
            isOpen: true,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) => {
              if (surface.id !== surfaceId || surface.kind !== "terminal") return surface;
              const { splitDirection: _splitDirection, ...baseSurface } = surface;
              return {
                ...baseSurface,
                terminalIds: surface.terminalIds.includes(terminalId)
                  ? surface.terminalIds
                  : [...surface.terminalIds, terminalId],
                activeTerminalId: terminalId,
                ...(direction === "vertical" ? { splitDirection: "vertical" as const } : {}),
              };
            }),
          })),
        ),
      activateTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          userAction(state, ref, (current) => ({
            ...current,
            activeSurfaceId: surfaceId,
            surfaces: current.surfaces.map((surface) =>
              surface.id === surfaceId &&
              surface.kind === "terminal" &&
              surface.terminalIds.includes(terminalId)
                ? { ...surface, activeTerminalId: terminalId }
                : surface,
            ),
          })),
        ),
      closeTerminal: (ref, surfaceId, terminalId) =>
        set((state) =>
          closeAction(state, ref, (current) => {
            const surface = current.surfaces.find(
              (entry) => entry.id === surfaceId && entry.kind === "terminal",
            );
            if (!surface || surface.kind !== "terminal") return current;
            const terminalIds = surface.terminalIds.filter((id) => id !== terminalId);
            if (terminalIds.length === 0) {
              const index = current.surfaces.findIndex((entry) => entry.id === surfaceId);
              const surfaces = current.surfaces.filter((entry) => entry.id !== surfaceId);
              return {
                ...current,
                surfaces,
                ...selectAfterRemoval(current, surface, index, surfaces),
              };
            }
            return {
              ...current,
              surfaces: current.surfaces.map((entry) =>
                entry.id === surfaceId && entry.kind === "terminal"
                  ? {
                      ...entry,
                      terminalIds,
                      activeTerminalId:
                        entry.activeTerminalId === terminalId
                          ? (terminalIds.at(-1) ?? terminalIds[0]!)
                          : entry.activeTerminalId,
                    }
                  : entry,
              ),
            };
          }),
        ),
      activateSurface: (ref, surfaceId) =>
        set((state) =>
          userAction(state, ref, (current) =>
            current.surfaces.some((surface) => surface.id === surfaceId)
              ? { ...current, isOpen: true, activeSurfaceId: surfaceId }
              : current,
          ),
        ),
      activateType: (ref, type) =>
        set((state) =>
          userAction(state, ref, (current) => {
            const remembered = current.activeSurfaceIdByType?.[type];
            const target =
              current.surfaces.find((surface) => surface.id === remembered) ??
              current.surfaces.find((surface) => rightPanelSurfaceType(surface.kind) === type);
            const activeSurfaceId = target?.id ?? null;
            if (
              current.isOpen &&
              current.activeSurfaceId === activeSurfaceId &&
              current.activeType === type
            ) {
              return current;
            }
            return { ...current, isOpen: true, activeSurfaceId, activeType: type };
          }),
        ),
      closeSurface: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, ref, (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            const removed = current.surfaces[index];
            if (!removed) return current;
            const surfaces = current.surfaces.filter((surface) => surface.id !== surfaceId);
            return {
              ...current,
              // The pull-request page has no type rail to show an empty type with.
              ...(surfaces.length === 0 && isPullRequestsPanelKey(rightPanelKey(ref))
                ? { isOpen: false }
                : {}),
              surfaces,
              ...selectAfterRemoval(current, removed, index, surfaces),
            };
          }),
        ),
      closeOtherSurfaces: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, ref, (current) => {
            const surface = current.surfaces.find((entry) => entry.id === surfaceId);
            if (!surface || current.surfaces.length === 1) return current;
            return {
              ...current,
              isOpen: true,
              surfaces: [surface],
              activeSurfaceId: surface.id,
            };
          }),
        ),
      closeSurfacesToRight: (ref, surfaceId) =>
        set((state) =>
          closeAction(state, ref, (current) => {
            const index = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (index < 0 || index === current.surfaces.length - 1) return current;
            const surfaces = current.surfaces.slice(0, index + 1);
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              surfaces,
              activeSurfaceId: activeStillExists ? current.activeSurfaceId : surfaceId,
            };
          }),
        ),
      closeAllSurfaces: (ref) =>
        set((state) =>
          closeAction(state, ref, (current) =>
            current.surfaces.length === 0
              ? current
              : { ...current, isOpen: false, surfaces: [], activeSurfaceId: null },
          ),
        ),
      // Reordering is not a choice about what the panel shows, so it leaves the
      // user-action revision alone and proactive opens still apply.
      moveSurface: (ref, surfaceId, toIndex) =>
        set((state) =>
          updatePanel(state, ref, (current) => {
            const fromIndex = current.surfaces.findIndex((surface) => surface.id === surfaceId);
            if (fromIndex < 0 || fromIndex === toIndex) return current;
            const surfaces = [...current.surfaces];
            surfaces.splice(toIndex, 0, ...surfaces.splice(fromIndex, 1));
            return { ...current, surfaces };
          }),
        ),
      reconcileBrowserSurfaces: (ref, tabIds, hiddenTabIds) =>
        set((state) =>
          automaticUpdate(state, ref, (current) => {
            const validIds = new Set(tabIds.map((tabId) => `browser:${tabId}`));
            // Filtered in place so browser tabs keep the order the user dragged them into.
            const kept = current.surfaces.filter(
              (surface) =>
                surface.kind !== "preview" ||
                (surface.id !== "browser:new" && validIds.has(surface.id)),
            );
            const knownIds = new Set(kept.map((surface) => surface.id));
            const added = tabIds
              .filter((tabId) => !knownIds.has(`browser:${tabId}`) && !hiddenTabIds?.has(tabId))
              .map((tabId) => browserSurface(tabId));
            const surfaces = [...kept, ...added];
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (activeStillExists || current.activeSurfaceId === null) {
              return { ...current, surfaces };
            }
            const fallbackBrowser = surfaces.find((surface) => surface.kind === "preview");
            return {
              ...current,
              surfaces,
              activeSurfaceId: fallbackBrowser?.id ?? null,
              activeType: "preview",
            };
          }),
        ),
      reconcileFileSurfaces: (ref, workspaceAvailable) =>
        set((state) =>
          automaticUpdate(state, ref, (current) => {
            if (workspaceAvailable) return current;
            const surfaces = current.surfaces.filter(
              (surface) =>
                surface.kind !== "files" &&
                (surface.kind !== "file" || surface.attachment !== undefined),
            );
            if (surfaces.length === current.surfaces.length) return current;
            const activeStillExists = surfaces.some(
              (surface) => surface.id === current.activeSurfaceId,
            );
            return {
              ...current,
              isOpen: surfaces.length > 0 ? current.isOpen : false,
              surfaces,
              activeSurfaceId: activeStillExists
                ? current.activeSurfaceId
                : (surfaces.at(-1)?.id ?? null),
            };
          }),
        ),
      show: (ref) =>
        set((state) =>
          userAction(state, ref, (current) =>
            current.isOpen ? current : { ...current, isOpen: true },
          ),
        ),
      close: (ref) =>
        set((state) =>
          userAction(state, ref, (current) =>
            current.isOpen ? { ...current, isOpen: false } : current,
          ),
        ),
      // Layout only: it changes no surface, so proactive panels still apply.
      setMaximized: (ref, maximized) =>
        set((state) =>
          automaticUpdate(state, ref, (current) => {
            if ((current.maximized ?? false) === maximized) return current;
            const { maximized: _maximized, ...rest } = current;
            return maximized ? { ...rest, maximized: true } : rest;
          }),
        ),
      toggleVisibility: (ref) =>
        set((state) =>
          userAction(state, ref, (current) => ({
            ...current,
            isOpen: !current.isOpen,
          })),
        ),
      toggle: (ref, kind) =>
        set((state) =>
          userAction(state, ref, (current) => {
            const active = current.surfaces.find(
              (surface) => surface.id === current.activeSurfaceId,
            );
            if (current.isOpen && active?.kind === kind) {
              return { ...current, isOpen: false };
            }
            if (kind === "preview") {
              const existing = current.surfaces.find((surface) => surface.kind === "preview");
              return upsertSurface(current, existing ?? browserSurface(null));
            }
            return upsertSurface(current, singletonSurface(kind));
          }),
        ),
      setThreadPanelOpen: (ref, presentation, open) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) => {
              const key = presentation === "inline" ? "inlineOpen" : "popoverOpen";
              return visibility[key] === open ? visibility : { ...visibility, [key]: open };
            },
          ),
        })),
      toggleThreadPanel: (ref, presentation) =>
        set((state) => ({
          threadPanelVisibilityByThreadKey: updateThreadPanelVisibilityMap(
            state.threadPanelVisibilityByThreadKey,
            scopedThreadKey(ref),
            (visibility) =>
              presentation === "inline"
                ? { ...visibility, inlineOpen: !visibility.inlineOpen }
                : { ...visibility, popoverOpen: !visibility.popoverOpen },
          ),
        })),
      // The checkout's panel stays for its other threads. Only state kept under the
      // thread's own key (its details card, or a panel from before it resolved) goes.
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (
            !(threadKey in state.threadPanelVisibilityByThreadKey) &&
            !(threadKey in state.byPanelKey)
          ) {
            return state;
          }
          const { [threadKey]: _visibility, ...threadPanelVisibilityByThreadKey } =
            state.threadPanelVisibilityByThreadKey;
          const { [threadKey]: _panel, ...byPanelKey } = state.byPanelKey;
          return { threadPanelVisibilityByThreadKey, byPanelKey };
        }),
    }),
    {
      name: RIGHT_PANEL_STORAGE_KEY,
      version: RIGHT_PANEL_STORAGE_VERSION,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        byPanelKey: Object.fromEntries(
          Object.entries(state.byPanelKey).filter(
            ([panelKey]) => !isPullRequestsPanelKey(panelKey),
          ),
        ),
        threadPanelVisibilityByThreadKey: Object.fromEntries(
          Object.entries(state.threadPanelVisibilityByThreadKey).flatMap(
            ([threadKey, visibility]) =>
              visibility.inlineOpen ? [] : [[threadKey, { inlineOpen: false, popoverOpen: false }]],
          ),
        ),
      }),
      migrate: (persistedState) => migratePersistedRightPanelState(persistedState),
    },
  ),
);

useRightPanelStore.subscribe((next, previous) => {
  if (next.closeRevisionByPanelKey === previous.closeRevisionByPanelKey) return;
  for (const [panelKey, revision] of Object.entries(next.closeRevisionByPanelKey)) {
    if (revision === previous.closeRevisionByPanelKey[panelKey]) continue;
    const threadRef = lastThreadRefByPanelKey.get(panelKey) ?? parseScopedThreadKey(panelKey);
    if (!threadRef) continue;
    const before = previous.byPanelKey[panelKey] ?? EMPTY_THREAD_STATE;
    const after = next.byPanelKey[panelKey] ?? EMPTY_THREAD_STATE;
    const removed = before.surfaces.filter(
      (surface) => !after.surfaces.some((entry) => entry.id === surface.id),
    );
    const closedInOrder = [
      ...removed.filter((surface) => surface.id !== before.activeSurfaceId),
      ...removed.filter((surface) => surface.id === before.activeSurfaceId),
    ];
    for (const surface of closedInOrder) {
      if (
        surface.kind === "terminal" ||
        (surface.kind === "preview" && surface.resourceId !== null)
      )
        continue;
      useClosedViewStore.getState().remember({ kind: "panel-tab", threadRef, surface });
    }
  }
});

export function selectThreadRightPanelState(
  byPanelKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): ThreadRightPanelState {
  if (!ref) return EMPTY_THREAD_STATE;
  return byPanelKey[rightPanelKey(ref)] ?? EMPTY_THREAD_STATE;
}

export function selectThreadPanelVisibility(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
): ThreadPanelVisibility {
  if (!ref) return DEFAULT_THREAD_PANEL_VISIBILITY;
  return byThreadKey[scopedThreadKey(ref)] ?? DEFAULT_THREAD_PANEL_VISIBILITY;
}

export function selectThreadPanelOpen(
  byThreadKey: Record<string, ThreadPanelVisibility>,
  ref: ScopedThreadRef | null | undefined,
  presentation: ThreadPanelPresentation,
): boolean {
  const visibility = selectThreadPanelVisibility(byThreadKey, ref);
  return presentation === "inline" ? visibility.inlineOpen : visibility.popoverOpen;
}

export function selectActiveRightPanel(
  byPanelKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelKind | null {
  const state = selectThreadRightPanelState(byPanelKey, ref);
  if (!state.isOpen) return null;
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId)?.kind ?? null;
}

export function selectActiveRightPanelSurface(
  byPanelKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byPanelKey, ref);
  if (!state.isOpen) return null;
  return selectSelectedRightPanelSurface(byPanelKey, ref);
}

/** The selected surface even while the panel is hidden, so a layout control can restore it. */
export function selectSelectedRightPanelSurface(
  byPanelKey: Record<string, ThreadRightPanelState>,
  ref: ScopedThreadRef | null | undefined,
): RightPanelSurface | null {
  const state = selectThreadRightPanelState(byPanelKey, ref);
  return state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null;
}

/** The type the panel shows: the selected surface's, else the type picked while empty. */
export function selectActiveRightPanelType(
  state: ThreadRightPanelState,
): RightPanelSurfaceType | null {
  const selected = state.surfaces.find((surface) => surface.id === state.activeSurfaceId);
  return selected ? rightPanelSurfaceType(selected.kind) : (state.activeType ?? null);
}
