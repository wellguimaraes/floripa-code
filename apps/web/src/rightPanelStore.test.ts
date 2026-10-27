import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { useClosedViewStore } from "./closedViewStore";
import {
  migratePersistedRightPanelState,
  pullRequestSurface,
  pullRequestSurfaceId,
  selectActiveRightPanel,
  selectActiveRightPanelSurface,
  selectActiveRightPanelType,
  selectSelectedRightPanelSurface,
  selectThreadPanelOpen,
  selectThreadPanelVisibility,
  selectThreadRightPanelState,
  setRightPanelScopeResolver,
  threadPullRequestSurfaces,
  useRightPanelStore,
} from "./rightPanelStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
  useRightPanelStore.setState({
    byPanelKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByPanelKey: {},
    closeRevisionByPanelKey: {},
  });
});

afterEach(() => {
  setRightPanelScopeResolver(() => null);
});

const panelState = (ref = refA) =>
  selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, ref);

describe("rightPanelStore", () => {
  it("records single and bulk tab closes, newest first", () => {
    const store = useRightPanelStore.getState();
    const pr = pullRequestSurface({
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 42,
    });
    store.openFile(refA, "src/app.ts");
    store.open(refA, "device");
    store.openPullRequest(refA, pr);
    store.open(refA, "diff");
    store.closeSurface(refA, pr.id);
    store.closeSurfacesToRight(refA, "device");
    store.closeOtherSurfaces(refA, "file:src/app.ts");
    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => (entry.kind === "panel-tab" ? entry.surface.id : null)),
    ).toEqual(["device", "diff", pr.id]);
  });

  it("reopens the active tab first after a bulk close", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "files");
    store.open(refA, "diff");
    store.open(refA, "device");
    store.activateSurface(refA, "diff");
    store.closeAllSurfaces(refA);

    expect(
      useClosedViewStore
        .getState()
        .entries.map((entry) => entry.kind === "panel-tab" && entry.surface.id),
    ).toEqual(["diff", "device", "files"]);
  });

  it("does not save an incidental Files replacement when opening an existing file", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "src/app.ts");
    store.open(refA, "files");
    store.openFile(refA, "src/app.ts");

    expect(useClosedViewStore.getState().entries).toEqual([]);
  });

  it("ignores session tabs without browser snapshots and records the empty browser tab", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(refA, "tab-1");
    store.closeSurface(refA, "browser:tab-1");
    expect(useClosedViewStore.getState().entries).toEqual([]);
    store.openBrowser(refA, null);
    store.closeSurface(refA, "browser:new");
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", surface: { id: "browser:new", resourceId: null } },
    ]);
  });

  it("keeps a dismissed device hidden after another file opens", () => {
    const store = useRightPanelStore.getState();
    const device = {
      hostId: "nucbox",
      deviceId: "emulator-5580",
      name: "Pixel",
      platform: "android",
    } as const;
    store.openFile(refA, "src/app.ts");
    store.closeSurface(refA, "file:src/app.ts");
    store.openDevice(refA, device);
    store.closeSurface(refA, "device:nucbox:emulator-5580");

    store.openFile(refA, "src/app.ts");
    store.openDevice(refA, device, true);

    // Closing the first file left the checkout's tree in its place.
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces,
    ).toEqual([
      expect.objectContaining({ id: "files" }),
      expect.objectContaining({ id: "file:src/app.ts" }),
    ]);
  });

  it("shows the files tree whenever the Files type has no file selected", () => {
    const store = useRightPanelStore.getState();
    store.activateType(refA, "files");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA),
    ).toMatchObject({ isOpen: true, activeType: "files", activeSurfaceId: "files" });

    store.openFile(refA, "src/app.ts");
    store.closeSurface(refA, "file:src/app.ts");
    store.closeSurface(refA, "files");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA),
    ).toMatchObject({ isOpen: true, activeType: "files", activeSurfaceId: "files" });
  });

  it("records only closed tabs when a panel is hidden or a terminal tab closes", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.openFile(refA, "src/app.ts");
    store.closeSurface(refA, "file:src/app.ts");
    store.close(refA);
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", threadRef: refA, surface: { id: "file:src/app.ts" } },
    ]);
    store.toggleVisibility(refA);
    store.toggle(refA, "diff");
    store.openTerminal(refA, "term-1");
    store.closeSurface(refA, "terminal:term-1");
    expect(useClosedViewStore.getState().entries).toMatchObject([
      { kind: "panel-tab", threadRef: refA, surface: { id: "file:src/app.ts" } },
    ]);
    expect(useClosedViewStore.getState().entries).toHaveLength(1);
  });

  it("gives each host/device its own tab and preserves renamed tabs", () => {
    const store = useRightPanelStore.getState();
    const android = {
      hostId: "nucbox",
      deviceId: "emulator-5580",
      name: "Pixel",
      platform: "android",
    } as const;
    const ios = { hostId: "macmini", deviceId: "ios-1", name: "iPhone", platform: "ios" } as const;
    store.open(refA, "device");
    store.openDevice(refA, android);
    store.open(refA, "device");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces,
    ).toHaveLength(2);
    store.openDevice(refA, ios);
    let state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      "device:nucbox:emulator-5580",
      "device:macmini:ios-1",
    ]);
    store.renameDevice(refA, "device:nucbox:emulator-5580", "Android test");
    store.openDevice(refA, android);
    state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.surfaces).toHaveLength(2);
    expect(state.surfaces[0]).toMatchObject({ title: "Android test", target: android });
    expect(state.activeSurfaceId).toBe("device:nucbox:emulator-5580");
    store.closeSurface(refA, state.activeSurfaceId!);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces,
    ).toEqual([expect.objectContaining({ target: ios })]);
  });

  it("does not collide when two hosts expose the same device id", () => {
    const store = useRightPanelStore.getState();
    const device = { deviceId: "emulator-5554", name: "Pixel", platform: "android" } as const;
    store.openDevice(refA, { ...device, hostId: "a:b" });
    store.openDevice(refA, { ...device, hostId: "a" });
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces,
    ).toHaveLength(2);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refB).surfaces,
    ).toHaveLength(0);
  });

  it.each(["one", "all", "others", "right"])(
    "keeps device tabs dismissed across reload after closing %s",
    (mode) => {
      const store = useRightPanelStore.getState();
      const target = {
        hostId: "nucbox",
        deviceId: "emulator-5580",
        name: "Pixel",
        platform: "android",
      } as const;
      store.open(refA, "files");
      store.openDevice(refA, target);
      if (mode === "one") store.closeSurface(refA, "device:nucbox:emulator-5580");
      if (mode === "all") store.closeAllSurfaces(refA);
      if (mode === "others") store.closeOtherSurfaces(refA, "files");
      if (mode === "right") store.closeSurfacesToRight(refA, "files");
      const { partialize } = useRightPanelStore.persist.getOptions();
      const persisted = JSON.parse(JSON.stringify(partialize!(useRightPanelStore.getState())));
      useRightPanelStore.setState(persisted);
      store.openDevice(refA, target, true);
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces.some(
          (surface) => surface.kind === "device",
        ),
      ).toBe(false);
      store.openDevice(refA, target);
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces.some(
          (surface) => surface.kind === "device",
        ),
      ).toBe(true);
    },
  );

  const completedDiff = { id: "diff", kind: "diff" } as const;
  const linkedPullRequest = pullRequestSurface({
    projectId: "project-a",
    repository: "pingdotgg/t3code",
    number: 42,
  });

  it.each([
    { order: "diff-first", surface: linkedPullRequest },
    { order: "pull-request-first", surface: linkedPullRequest },
    { order: "diff-first", surface: { id: "pull-requests", kind: "pull-requests" } as const },
    {
      order: "pull-request-first",
      surface: { id: "pull-requests", kind: "pull-requests" } as const,
    },
  ])(
    "prioritizes $surface.kind over browser and diff with $order delivery",
    ({ order, surface }) => {
      const store = useRightPanelStore.getState();
      store.openBrowser(refA, "existing-browser");
      const revision = store.getUserActionRevision(refA);
      const requests = order === "diff-first" ? [completedDiff, surface] : [surface, completedDiff];
      for (const surface of requests) store.openProactive(refA, surface, revision);
      store.reconcileBrowserSurfaces(refA, ["existing-browser", "agent-browser"]);

      expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byPanelKey, refA)).toEqual(
        surface,
      );

      store.open(refA, "diff");
      expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe("diff");
    },
  );

  it.each([
    { choice: "file", choose: () => useRightPanelStore.getState().openFile(refA, "src/app.ts") },
    {
      choice: "pull request",
      choose: () =>
        useRightPanelStore.getState().openPullRequest(refA, { ...linkedPullRequest, number: 41 }),
    },
    { choice: "browser", choose: () => useRightPanelStore.getState().openBrowser(refA, "tab-a") },
    {
      choice: "terminal",
      choose: () => useRightPanelStore.getState().openTerminal(refA, "term-1"),
    },
    {
      choice: "same tab",
      choose: () => useRightPanelStore.getState().activateSurface(refA, "diff"),
    },
    { choice: "hide", choose: () => useRightPanelStore.getState().close(refA) },
    { choice: "toggle", choose: () => useRightPanelStore.getState().toggle(refA, "diff") },
    { choice: "close all", choose: () => useRightPanelStore.getState().closeAllSurfaces(refA) },
    {
      choice: "terminal close",
      choose: () => {
        const store = useRightPanelStore.getState();
        store.openTerminal(refA, "term-1");
        store.closeTerminal(refA, "terminal:term-1", "term-1");
      },
    },
  ])("keeps a later $choice choice when automatic requests arrive", ({ choose }) => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    const revision = store.getUserActionRevision(refA);
    choose();
    const chosen = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);

    expect(store.openProactive(refA, completedDiff, revision)).toBe(false);
    expect(store.openProactive(refA, linkedPullRequest, revision)).toBe(false);
    expect(
      store.openProactive(refA, { id: "pull-requests", kind: "pull-requests" }, revision),
    ).toBe(false);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA)).toBe(
      chosen,
    );
  });

  it("allows automatic panels for a later turn after a manual choice", () => {
    const store = useRightPanelStore.getState();
    const firstTurnRevision = store.getUserActionRevision(refA);
    store.openFile(refA, "src/app.ts");
    expect(store.openProactive(refA, completedDiff, firstTurnRevision)).toBe(false);

    const nextTurnRevision = store.getUserActionRevision(refA);
    expect(store.openProactive(refA, completedDiff, nextTurnRevision)).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe("diff");
  });

  it("keeps manual choices scoped to their thread and environment", () => {
    const otherEnvironment = scopeThreadRef("env-2" as EnvironmentId, refA.threadId);
    const store = useRightPanelStore.getState();
    const revision = store.getUserActionRevision(refA);
    store.openFile(refB, "src/app.ts");
    store.openFile(otherEnvironment, "src/app.ts");

    expect(store.openProactive(refA, completedDiff, revision)).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refB)).toBe("file");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, otherEnvironment)).toBe(
      "file",
    );
  });

  it("derives one pull-request tab per linked pull request, the list first when several", () => {
    const link = (number: number) => ({
      host: "github.com",
      repository: "pingdotgg/t3code",
      number,
      url: `https://github.com/pingdotgg/t3code/pull/${number}`,
    });
    const surfaces = threadPullRequestSurfaces({
      projectId: "project-a",
      list: true,
      // The thread's own pull request can lack a host and still match its link.
      current: { projectId: "project-a", repository: "PingDotGG/t3code", number: 2 },
      links: [link(1), link(2)],
    });

    expect(surfaces.map((surface) => surface.id)).toEqual([
      "pull-requests",
      pullRequestSurfaceId({ projectId: "project-a", repository: "PingDotGG/t3code", number: 2 }),
      pullRequestSurface({ projectId: "project-a", ...link(1) }).id,
    ]);
  });

  it("keeps pull-request tabs in step with the thread without closing the shown one", () => {
    const store = useRightPanelStore.getState();
    const first = pullRequestSurface({ projectId: "project-a", repository: "o/r", number: 1 });
    const second = pullRequestSurface({ projectId: "project-a", repository: "o/r", number: 2 });
    const fromLink = pullRequestSurface({ projectId: "project-a", repository: "o/r", number: 9 });
    store.openFile(refA, "src/app.ts");
    store.activateType(refA, "pull-request");

    store.reconcilePullRequestSurfaces(refA, [first, second]);
    // Picked before its tabs arrived, the type shows the first instead of staying empty.
    expect(panelState().activeSurfaceId).toBe(first.id);

    store.openPullRequest(refA, fromLink);
    store.reconcilePullRequestSurfaces(refA, [second]);
    expect(panelState().surfaces.map((surface) => surface.id)).toEqual([
      "file:src/app.ts",
      second.id,
      fromLink.id,
    ]);

    store.activateSurface(refA, second.id);
    store.reconcilePullRequestSurfaces(refA, [second]);
    expect(panelState().surfaces.map((surface) => surface.id)).toEqual([
      "file:src/app.ts",
      second.id,
    ]);
  });

  it("does not treat resource reconciliation as a manual choice", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "src/app.ts");
    const revision = store.getUserActionRevision(refA);
    store.reconcileBrowserSurfaces(refA, ["agent-browser"]);
    store.reconcileFileSurfaces(refA, false);

    expect(store.openProactive(refA, completedDiff, revision)).toBe(true);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe("diff");
  });

  it("keeps a maximized panel per thread without counting it as a manual choice", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "preview");
    store.open(refB, "diff");
    const revision = store.getUserActionRevision(refA);
    store.setMaximized(refA, true);
    store.setMaximized(refB, true);
    store.setMaximized(refB, false);

    const { byPanelKey } = useRightPanelStore.getState();
    expect(selectThreadRightPanelState(byPanelKey, refA).maximized).toBe(true);
    expect(selectThreadRightPanelState(byPanelKey, refB).maximized).toBeUndefined();
    expect(store.getUserActionRevision(refA)).toBe(revision);
  });

  it("drops pre-checkout panel layouts while carrying over the thread details choice", () => {
    expect(
      migratePersistedRightPanelState({
        byPanelKey: {
          "env-1:thread-A": {
            isOpen: true,
            activeSurfaceId: "terminal",
            surfaces: [{ id: "terminal", kind: "terminal" }],
            maximized: true,
          },
        },
        threadPanelVisibilityByThreadKey: {
          "env-1:thread-A": { inlineOpen: false, popoverOpen: false },
        },
      }),
    ).toEqual({
      byPanelKey: {},
      threadPanelVisibilityByThreadKey: {
        "env-1:thread-A": { inlineOpen: false, popoverOpen: false },
      },
    });
  });

  it("persists inline preference without restoring an open popover", () => {
    expect(
      migratePersistedRightPanelState({
        threadPanelVisibilityByThreadKey: {
          "env-1:thread-A": { inlineOpen: false, popoverOpen: true },
          "env-1:thread-B": { inlineOpen: true, popoverOpen: true },
        },
      }),
    ).toEqual({
      byPanelKey: {},
      threadPanelVisibilityByThreadKey: {
        "env-1:thread-A": { inlineOpen: false, popoverOpen: false },
      },
    });
  });

  it("tracks inline and popover visibility independently", () => {
    const store = useRightPanelStore.getState();

    expect(selectThreadPanelOpen(store.threadPanelVisibilityByThreadKey, refA, "inline")).toBe(
      true,
    );
    expect(selectThreadPanelOpen(store.threadPanelVisibilityByThreadKey, refA, "popover")).toBe(
      false,
    );

    store.setThreadPanelOpen(refA, "inline", false);
    store.toggleThreadPanel(refA, "popover");

    expect(
      selectThreadPanelVisibility(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        refA,
      ),
    ).toEqual({ inlineOpen: false, popoverOpen: true });
    expect(
      selectThreadPanelVisibility(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        refB,
      ),
    ).toEqual({ inlineOpen: true, popoverOpen: false });
  });

  it("closes the popover atomically when the real right panel opens", () => {
    useRightPanelStore.getState().setThreadPanelOpen(refA, "popover", true);
    useRightPanelStore.getState().open(refA, "diff");

    expect(
      selectThreadPanelVisibility(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        refA,
      ),
    ).toEqual({ inlineOpen: true, popoverOpen: false });
  });

  it("keeps an open popover visible by promoting it to inline when the real panel closes", () => {
    const store = useRightPanelStore.getState();
    store.open(refA, "diff");
    store.setThreadPanelOpen(refA, "inline", false);
    store.setThreadPanelOpen(refA, "popover", true);
    store.close(refA);

    expect(
      selectThreadPanelVisibility(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        refA,
      ),
    ).toEqual({ inlineOpen: true, popoverOpen: true });
  });

  it("open sets the active panel for a thread", () => {
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe("preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refB)).toBeNull();
  });

  it("opening a different kind keeps both surfaces and activates the new one", () => {
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().open(refA, "preview");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe("preview");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces,
    ).toHaveLength(2);
  });

  it("reopening an inactive singleton activates its existing surface", () => {
    useRightPanelStore.getState().open(refA, "diff");
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().open(refA, "diff");

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "diff",
      surfaces: [
        { id: "diff", kind: "diff" },
        { id: "device", kind: "device" },
      ],
    });
  });

  it("keeps files as a singleton surface", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().open(refA, "files");
    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "files",
      surfaces: [{ id: "files", kind: "files" }],
    });
  });

  it("opens workspace-root links as the singleton files explorer", () => {
    const store = useRightPanelStore.getState();
    store.openFile(refA, "README.md");
    store.openFile(refA, ".");
    store.openFile(refA, ".");
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.activeSurfaceId).toBe("files");
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["file:README.md", "files"]);
    store.closeSurface(refA, "files");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).activeSurfaceId,
    ).toBe("file:README.md");
    store.openFile(refA, ".");
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).activeSurfaceId,
    ).toBe("files");
  });

  it("keeps the file tree as its own tab beside opened files", () => {
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openFile(refA, "README.md");

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "file:README.md",
      surfaces: [
        { id: "files", kind: "files" },
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 2,
        },
        {
          id: "file:README.md",
          kind: "file",
          relativePath: "README.md",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it.each([
    ["generated\\", "generated"],
    ["notes/meeting ", "notes/meeting"],
    [" notes/meeting", "notes/meeting"],
  ])("keeps %j and %j in separate file tabs", (firstPath, secondPath) => {
    useRightPanelStore.getState().openFile(refA, firstPath);
    useRightPanelStore.getState().openFile(refA, secondPath);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces,
    ).toMatchObject([
      { id: `file:${firstPath}`, relativePath: firstPath },
      { id: `file:${secondPath}`, relativePath: secondPath },
    ]);
  });

  it.each([
    ["docs/", "docs"],
    ["docs///", "docs"],
    ["/", "/"],
    ["C:/", "C:/"],
  ])("reuses the folder tab for %j and %j", (linkPath, treePath) => {
    useRightPanelStore.getState().openFile(refA, linkPath);
    useRightPanelStore.getState().openFile(refA, treePath);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces,
    ).toMatchObject([{ id: `file:${treePath}`, relativePath: treePath, revealRequestId: 2 }]);
  });

  it("opens an attachment as a file tab beside the file tree", () => {
    const attachment = {
      type: "file" as const,
      id: "thread-A-attachment-pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    };
    useRightPanelStore.getState().open(refA, "files");
    useRightPanelStore.getState().openAttachment(refA, attachment);

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "attachment:thread-A-attachment-pdf",
      surfaces: [
        { id: "files", kind: "files" },
        {
          id: "attachment:thread-A-attachment-pdf",
          kind: "file",
          relativePath: "report.pdf",
          revealLine: null,
          revealRequestId: 0,
          attachment,
        },
      ],
    });
  });

  it("keeps attachment and workspace file ids disjoint", () => {
    useRightPanelStore.getState().openFile(refA, "attachment:shared-id");
    useRightPanelStore.getState().openAttachment(refA, {
      type: "file",
      id: "shared-id",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["file:attachment:shared-id", "attachment:shared-id"]);
  });

  it("updates line reveal requests when reopening a file surface", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 42);
    useRightPanelStore.getState().openFile(refA, "src/index.ts", 87);

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: 87,
          revealRequestId: 2,
        },
      ],
    });

    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 3,
        },
      ],
    });
  });

  it("removes persisted file surfaces when their workspace no longer exists", () => {
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().openFile(refA, "README.md");

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "device",
      surfaces: [{ id: "device", kind: "device" }],
    });

    useRightPanelStore.getState().openFile(refB, "conductor.json");
    useRightPanelStore.getState().reconcileFileSurfaces(refB, false);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refB)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("keeps attachment previews when their workspace is unavailable", () => {
    const attachment = {
      type: "file" as const,
      id: "thread-A-attachment-pdf",
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
    };
    useRightPanelStore.getState().openFile(refA, "README.md");
    useRightPanelStore.getState().openAttachment(refA, attachment);

    useRightPanelStore.getState().reconcileFileSurfaces(refA, false);

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "attachment:thread-A-attachment-pdf",
      surfaces: [
        {
          id: "attachment:thread-A-attachment-pdf",
          kind: "file",
          relativePath: "report.pdf",
          revealLine: null,
          revealRequestId: 0,
          attachment,
        },
      ],
    });
  });

  it("close hides the panel without clearing its selected surface", () => {
    useRightPanelStore.getState().open(refA, "device");
    useRightPanelStore.getState().close(refA);
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBeNull();
    expect(selectSelectedRightPanelSurface(useRightPanelStore.getState().byPanelKey, refA)).toEqual(
      { id: "device", kind: "device" },
    );
    expect(panelState()).toMatchObject({
      isOpen: false,
      activeSurfaceId: "device",
      surfaces: [{ id: "device", kind: "device" }],
    });
  });

  it("toggles empty panel visibility without creating a surface", () => {
    useRightPanelStore.getState().toggleVisibility(refA);
    expect(selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA)).toEqual({
      isOpen: true,
      activeSurfaceId: null,
      surfaces: [],
    });

    useRightPanelStore.getState().toggleVisibility(refA);
    expect(useRightPanelStore.getState().byPanelKey).toEqual({});
  });

  it("toggle hides the panel without discarding the active surface", () => {
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe("diff");
    useRightPanelStore.getState().toggle(refA, "diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBeNull();
    expect(panelState()).toMatchObject({
      isOpen: false,
      activeSurfaceId: "diff",
      surfaces: [{ id: "diff", kind: "diff" }],
    });
  });

  it("toggle to a different kind switches active", () => {
    useRightPanelStore.getState().toggle(refA, "preview");
    useRightPanelStore.getState().toggle(refA, "device");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe("device");
  });

  it("removeThread forgets the thread's details choice but leaves the checkout's panel", () => {
    setRightPanelScopeResolver(() => "env-1:checkout-1");
    const store = useRightPanelStore.getState();
    store.open(refA, "device");
    store.setThreadPanelOpen(refA, "inline", false);
    store.removeThread(refA);
    expect(
      selectThreadPanelVisibility(
        useRightPanelStore.getState().threadPanelVisibilityByThreadKey,
        refA,
      ),
    ).toEqual({ inlineOpen: true, popoverOpen: false });
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refB)).toBe("device");
  });

  it("close on never-opened thread is a no-op", () => {
    useRightPanelStore.getState().close(refA);
    expect(useRightPanelStore.getState().byPanelKey).toEqual({});
  });

  it("tracks one surface per browser session", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual(["browser:tab-a", "browser:tab-b"]);
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byPanelKey, refA)).toEqual({
      id: "browser:tab-b",
      kind: "preview",
      resourceId: "tab-b",
    });
  });

  it("tracks one surface per pull request", () => {
    const first = { projectId: "project-a", repository: "pingdotgg/t3code", number: 4909 };
    const second = { projectId: "project-a", repository: "pingdotgg/t3code", number: 4910 };
    useRightPanelStore.getState().openPullRequest(refA, first);
    useRightPanelStore.getState().openPullRequest(refA, second);
    const url = "https://gitlab.example.com/pingdotgg/t3code/-/merge_requests/4909";
    useRightPanelStore.getState().openPullRequest(refA, { ...first, url });
    useRightPanelStore.getState().openPullRequest(refA, first);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(first),
      pullRequestSurfaceId(second),
    ]);
    expect(state.activeSurfaceId).toBe(pullRequestSurfaceId(first));
    expect(
      selectActiveRightPanelSurface(useRightPanelStore.getState().byPanelKey, refA),
    ).toMatchObject({ url });
    expect(state.surfaces[1]).not.toHaveProperty("url");
  });

  it("keeps matching repository and number on different hosts as separate tabs", () => {
    const first = { projectId: "project-a", repository: "acme/api", number: 7, host: "github.com" };
    const second = { ...first, host: "github.example.com" };
    useRightPanelStore.getState().openPullRequest(refA, first);
    useRightPanelStore.getState().openPullRequest(refA, second);
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.surfaces).toEqual([pullRequestSurface(first), pullRequestSurface(second)]);
    expect(pullRequestSurfaceId({ ...first, host: "GITHUB.COM" })).toBe(
      pullRequestSurfaceId(first),
    );
  });

  it("keeps one pull request read from two servers as two tabs", () => {
    const local = {
      environmentId: "local",
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 4909,
    };
    const remote = { ...local, environmentId: "remote" };

    useRightPanelStore.getState().openPullRequest(refA, local);
    useRightPanelStore.getState().openPullRequest(refA, remote);

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(local),
      pullRequestSurfaceId(remote),
    ]);
  });

  it("keeps the page's panel tabs reachable when the set of connected servers changes", () => {
    // The pull-requests page keys its one shared panel by a fixed sentinel environment, not by
    // whichever capable server happens to sort first (see PULL_REQUESTS_PANEL_ENVIRONMENT_ID in
    // _chat.pull-requests.tsx) — a server disconnecting must not move every open tab to a store
    // key nobody wrote them under.
    const panelId = ThreadId.make("pull-requests-panel");
    const stableRef = scopeThreadRef("pull-requests-panel" as EnvironmentId, panelId);
    const fromServerA = {
      environmentId: "server-a",
      projectId: "project-a",
      repository: "pingdotgg/t3code",
      number: 1,
    };
    const fromServerB = {
      environmentId: "server-b",
      projectId: "project-b",
      repository: "pingdotgg/t3code",
      number: 2,
    };

    // Both servers connected: tabs from each open under the one stable ref.
    useRightPanelStore.getState().openPullRequest(stableRef, fromServerA);
    useRightPanelStore.getState().openPullRequest(stableRef, fromServerB);

    // Server A disconnects. The stable ref does not depend on which servers remain connected, so
    // the same lookup still finds both tabs.
    const state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, stableRef);
    expect(state.surfaces.map((surface) => surface.id)).toEqual([
      pullRequestSurfaceId(fromServerA),
      pullRequestSurfaceId(fromServerB),
    ]);

    // The bug this guards against: a ref keyed by the first capable environment instead of a
    // fixed sentinel changes identity when that environment drops out, and a lookup under the new
    // key finds nothing even though the tabs are still sitting under the old one.
    const refWhileBothConnected = scopeThreadRef("server-a" as EnvironmentId, panelId);
    const refAfterServerADisconnects = scopeThreadRef("server-b" as EnvironmentId, panelId);
    expect(refWhileBothConnected).not.toEqual(refAfterServerADisconnects);
    expect(
      selectThreadRightPanelState(
        useRightPanelStore.getState().byPanelKey,
        refAfterServerADisconnects,
      ).surfaces,
    ).toEqual([]);
  });

  it("tracks one surface per terminal session", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openTerminal(refA, "term-2");

    const state = selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA);
    expect(state.surfaces).toEqual([
      {
        id: "terminal:term-1",
        kind: "terminal",
        resourceId: "term-1",
        terminalIds: ["term-1"],
        activeTerminalId: "term-1",
      },
      {
        id: "terminal:term-2",
        kind: "terminal",
        resourceId: "term-2",
        terminalIds: ["term-2"],
        activeTerminalId: "term-2",
      },
    ]);
    expect(state.activeSurfaceId).toBe("terminal:term-2");
  });

  it("tracks split panes and the active pane within a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byPanelKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
    });

    useRightPanelStore.getState().activateTerminal(refA, "terminal:term-1", "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");
    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byPanelKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-2"],
      activeTerminalId: "term-2",
    });
  });

  it("tracks vertical layout for a terminal surface", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().splitTerminal(refA, "terminal:term-1", "term-2", "vertical");

    expect(selectActiveRightPanelSurface(useRightPanelStore.getState().byPanelKey, refA)).toEqual({
      id: "terminal:term-1",
      kind: "terminal",
      resourceId: "term-1",
      terminalIds: ["term-1", "term-2"],
      activeTerminalId: "term-2",
      splitDirection: "vertical",
    });
  });

  it("closing the final terminal pane with no other tab collapses the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeTerminal(refA, "terminal:term-1", "term-1");

    expect(panelState()).toMatchObject({ isOpen: false, activeSurfaceId: null, surfaces: [] });
  });

  it("closing the active tab selects a neighbour of the same type, then the next type's", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(refA, "term-1");
    store.openBrowser(refA, "tab-a");
    store.openTerminal(refA, "term-2");
    store.openTerminal(refA, "term-3");
    store.activateSurface(refA, "terminal:term-2");

    store.closeSurface(refA, "terminal:term-2");
    expect(panelState().activeSurfaceId).toBe("terminal:term-3");
    store.closeSurface(refA, "terminal:term-3");
    expect(panelState().activeSurfaceId).toBe("terminal:term-1");

    store.closeSurface(refA, "terminal:term-1");
    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "browser:tab-a",
      surfaces: [{ id: "browser:tab-a" }],
    });
    expect(selectActiveRightPanelType(panelState())).toBe("preview");
  });

  it("moves on to the next type with tabs in rail order, on that type's last tab", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(refA, "term-1");
    store.openBrowser(refA, "tab-a");
    store.openBrowser(refA, "tab-b");
    store.activateSurface(refA, "browser:tab-a");
    store.open(refA, "diff");

    // Diff is last in the rail, so the next type wraps around to the terminal.
    store.closeSurface(refA, "diff");
    expect(panelState().activeSurfaceId).toBe("terminal:term-1");
    // The browser comes back on the tab last selected there.
    store.closeSurface(refA, "terminal:term-1");
    expect(panelState()).toMatchObject({ isOpen: true, activeSurfaceId: "browser:tab-a" });
  });

  it("closing the final surface collapses the panel", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().closeSurface(refA, "terminal:term-1");

    expect(panelState()).toMatchObject({ isOpen: false, activeSurfaceId: null, surfaces: [] });
  });

  it("activateType restores the type's last tab or shows the type empty", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(refA, "term-1");
    store.openTerminal(refA, "term-2");
    store.activateSurface(refA, "terminal:term-1");
    store.openBrowser(refA, "tab-a");

    store.activateType(refA, "terminal");
    expect(panelState().activeSurfaceId).toBe("terminal:term-1");
    store.activateType(refA, "preview");
    expect(panelState().activeSurfaceId).toBe("browser:tab-a");

    // A remembered tab that has since closed falls back to the type's remaining tab.
    store.closeSurface(refA, "terminal:term-1");
    store.activateType(refA, "terminal");
    expect(panelState().activeSurfaceId).toBe("terminal:term-2");

    store.close(refA);
    store.activateType(refA, "diff");
    expect(panelState()).toMatchObject({ isOpen: true, activeSurfaceId: null });
    expect(selectActiveRightPanelType(panelState())).toBe("diff");
    expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBeNull();
  });

  it("closing other surfaces keeps the selected surface active", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeOtherSurfaces(refA, "file:src/index.ts");

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "file:src/index.ts",
      surfaces: [
        {
          id: "file:src/index.ts",
          kind: "file",
          relativePath: "src/index.ts",
          revealLine: null,
          revealRequestId: 1,
        },
      ],
    });
  });

  it("closing surfaces to the right activates the selected surface when active was removed", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");
    useRightPanelStore.getState().openTerminal(refA, "term-1");

    useRightPanelStore.getState().closeSurfacesToRight(refA, "browser:tab-a");

    expect(panelState()).toMatchObject({
      isOpen: true,
      activeSurfaceId: "browser:tab-a",
      surfaces: [{ id: "browser:tab-a", kind: "preview", resourceId: "tab-a" }],
    });
  });

  it("closing all surfaces closes the panel", () => {
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openFile(refA, "src/index.ts");

    useRightPanelStore.getState().closeAllSurfaces(refA);

    expect(selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA)).toEqual({
      isOpen: false,
      activeSurfaceId: null,
      surfaces: [],
    });
  });

  it("does not replace a stale surface with a hidden tab, but preserves explicit opens", () => {
    const store = useRightPanelStore.getState();
    store.openBrowser(refA, "stale-tab");
    store.reconcileBrowserSurfaces(refA, ["hidden-tab"], new Set(["hidden-tab"]));
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA),
    ).toMatchObject({
      activeSurfaceId: null,
      surfaces: [],
    });

    store.openBrowser(refA, "hidden-tab");
    store.reconcileBrowserSurfaces(
      refA,
      ["hidden-tab", "other-tab"],
      new Set(["hidden-tab", "other-tab"]),
    );
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA),
    ).toMatchObject({
      isOpen: true,
      activeSurfaceId: "browser:hidden-tab",
      surfaces: [{ id: "browser:hidden-tab", kind: "preview", resourceId: "hidden-tab" }],
    });
  });

  it("reconciles browser surfaces without deleting other surface kinds", () => {
    useRightPanelStore.getState().openTerminal(refA, "term-1");
    useRightPanelStore.getState().openBrowser(refA, "tab-a");
    useRightPanelStore.getState().openBrowser(refA, "tab-b");
    useRightPanelStore.getState().reconcileBrowserSurfaces(refA, ["tab-b", "tab-c"]);

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces.map(
        (surface) => surface.id,
      ),
    ).toEqual(["terminal:term-1", "browser:tab-b", "browser:tab-c"]);
  });

  it("moves a surface to a new index and keeps it there through browser reconciliation", () => {
    const store = useRightPanelStore.getState();
    store.openTerminal(refA, "term-1");
    store.openBrowser(refA, "tab-a");
    store.open(refA, "diff");
    const revision = store.getUserActionRevision(refA);
    const surfaceIds = () =>
      selectThreadRightPanelState(useRightPanelStore.getState().byPanelKey, refA).surfaces.map(
        (surface) => surface.id,
      );

    store.moveSurface(refA, "browser:tab-a", 0);
    expect(surfaceIds()).toEqual(["browser:tab-a", "terminal:term-1", "diff"]);
    store.moveSurface(refA, "browser:tab-a", 2);
    expect(surfaceIds()).toEqual(["terminal:term-1", "diff", "browser:tab-a"]);
    store.moveSurface(refA, "browser:tab-a", 0);

    store.reconcileBrowserSurfaces(refA, ["tab-a", "tab-b"]);
    expect(surfaceIds()).toEqual(["browser:tab-a", "terminal:term-1", "diff", "browser:tab-b"]);
    // Reordering is not a choice about what the panel shows.
    expect(store.getUserActionRevision(refA)).toBe(revision);
  });

  describe("panels shared by checkout", () => {
    it("shares one panel and one user-action revision between threads in the same checkout", () => {
      setRightPanelScopeResolver(() => "env-1:checkout-1");
      const store = useRightPanelStore.getState();
      const revision = store.getUserActionRevision(refB);

      store.openTerminal(refA, "term-1");

      expect(
        selectActiveRightPanelSurface(useRightPanelStore.getState().byPanelKey, refB)?.id,
      ).toBe("terminal:term-1");
      expect(store.getUserActionRevision(refB)).toBe(store.getUserActionRevision(refA));
      expect(store.openProactive(refB, completedDiff, revision)).toBe(false);
    });

    it("keeps panels of different checkouts separate", () => {
      setRightPanelScopeResolver((ref) =>
        ref.threadId === refA.threadId ? "env-1:checkout-1" : "env-1:checkout-2",
      );
      const store = useRightPanelStore.getState();
      const revision = store.getUserActionRevision(refB);

      store.openTerminal(refA, "term-1");

      expect(panelState(refB).surfaces).toEqual([]);
      expect(store.openProactive(refB, completedDiff, revision)).toBe(true);
      expect(selectActiveRightPanel(useRightPanelStore.getState().byPanelKey, refA)).toBe(
        "terminal",
      );
    });

    it("records the thread that closed a shared tab for reopening", () => {
      setRightPanelScopeResolver(() => "env-1:checkout-1");
      const store = useRightPanelStore.getState();

      store.openFile(refA, "src/app.ts");
      store.closeSurface(refB, "file:src/app.ts");
      store.open(refB, "diff");
      store.closeSurface(refA, "diff");

      expect(useClosedViewStore.getState().entries).toMatchObject([
        { kind: "panel-tab", threadRef: refA, surface: { id: "diff" } },
        { kind: "panel-tab", threadRef: refB, surface: { id: "file:src/app.ts" } },
      ]);
    });
  });
});
