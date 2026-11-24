// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { BrowserSurfaceSlot } from "./BrowserSurfaceSlot";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";

const TAB_ID = "tab-1";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 20, width: 300, height: 200 }),
  );
  useBrowserSurfaceStore.setState({ byTabId: {}, activityByTabId: {} });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BrowserSurfaceSlot", () => {
  it("hides the page while it stays mounted, as a closing panel keeps it", async () => {
    await act(async () => root.render(<BrowserSurfaceSlot tabId={TAB_ID} visible />));
    expect(useBrowserSurfaceStore.getState().byTabId[TAB_ID]?.visible).toBe(true);

    await act(async () => root.render(<BrowserSurfaceSlot tabId={TAB_ID} visible={false} />));
    expect(useBrowserSurfaceStore.getState().byTabId[TAB_ID]?.visible).toBe(false);
  });
});
