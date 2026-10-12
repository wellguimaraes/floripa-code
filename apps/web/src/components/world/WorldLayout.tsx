import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import {
  type CSSProperties,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { isElectron } from "../../env";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "../../hooks/useResizableWidth";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { ThreadRouteView } from "../ThreadRouteView";
import { Button } from "../ui/button";
import { SidebarInset, useSidebar, useSidebarVisibility } from "../ui/sidebar";
import { islandWorlds } from "./definitions/island";
import { palette } from "./scene/palette";
import { useWorldLook } from "./worldLookStore";
import { useWorldModeStore } from "./worldModeStore";

// three.js and the scene load only when someone opens the world.
const WorldCanvas = lazy(() => import("./WorldCanvas"));

const CHAT_MIN_WIDTH = 400;
const CHAT_DEFAULT_WIDTH = 720;
// Room left of the chat for its close button (4rem) and right of it for the margin (0.75rem).
const CHAT_GUTTERS = 76;

function readChatMaxWidth(): number {
  if (typeof window === "undefined") return CHAT_DEFAULT_WIDTH;
  return Math.max(CHAT_MIN_WIDTH, window.innerWidth - CHAT_GUTTERS);
}

/** The floating chat's width: dragged from its left edge, remembered in this browser. */
function useChatWidth() {
  const [maxWidth, setMaxWidth] = useState(readChatMaxWidth);
  useEffect(() => {
    const onResize = () => setMaxWidth(readChatMaxWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return useResizableWidth({
    storageKey: "t3code:world-chat-width:v1",
    defaultWidth: CHAT_DEFAULT_WIDTH,
    minWidth: CHAT_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });
}

/**
 * The chat layout in world mode. The URL still picks the open thread, so
 * clicking a character navigates to it and its chat floats over the world;
 * everything ChatView does on its own (forks, drafts, deletes) keeps working.
 */
export function WorldLayout({ target }: { readonly target: ThreadRouteTarget | null }) {
  const navigate = useNavigate();
  const setWorldMode = useWorldModeStore((state) => state.setEnabled);
  const panelRef = useRef<HTMLDivElement>(null);
  const readPanel = useCallback(() => panelRef.current, []);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const chatWidth = useChatWidth();
  const selectedKey = target?.kind === "server" ? scopedThreadKey(target.threadRef) : null;
  const look = useWorldLook(selectedKey ?? "");

  const openThread = (ref: ScopedThreadRef) =>
    navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  const closePanel = () => {
    void navigate({ to: "/" });
  };

  // The world takes the whole window: the sidebar folds away while it shows
  // and comes back, if it was open, when the world closes.
  const { open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const collapseSidebar = useEffectEvent(() => {
    const store = useWorldModeStore.getState();
    if (store.sidebarWasOpen === null) store.setSidebarWasOpen(sidebarOpen);
    setSidebarOpen(false);
    return () => {
      const wasOpen = useWorldModeStore.getState().sidebarWasOpen;
      useWorldModeStore.getState().setSidebarWasOpen(null);
      if (wasOpen === true) setSidebarOpen(true);
    };
  });
  useEffect(() => collapseSidebar(), []);

  useEffect(() => {
    useWorldModeStore.getState().setShown(true);
    return () => useWorldModeStore.getState().setShown(false);
  }, []);

  // Opening the sidebar is the way out of the world.
  const sidebarVisible = useSidebarVisibility();
  const sidebarWasVisible = useRef(sidebarVisible);
  useEffect(() => {
    const wasVisible = sidebarWasVisible.current;
    sidebarWasVisible.current = sidebarVisible;
    if (sidebarVisible && !wasVisible) setWorldMode(false);
  }, [setWorldMode, sidebarVisible]);

  useEffect(() => {
    if (target === null) return;
    // Escape closes the panel unless something in it (a menu, picker, dialog) took it first.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.repeat) return;
      // The message editor (ProseMirror) prevents every Escape; its menus also stop the event,
      // so one that gets here from the editor was not used.
      const fromEditor = event.target instanceof Element && event.target.closest(".ProseMirror");
      if (event.defaultPrevented && !fromEditor) return;
      event.preventDefault();
      void navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, target]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          <WorldCanvas
            definitions={islandWorlds}
            selectedKey={selectedKey}
            onExpand={openThread}
            onCloseChat={closePanel}
            panel={readPanel}
            toolbar={toolbar}
          />
        </Suspense>
      </div>
      <div
        className={cn(
          // Stacked over the chat panel so toolbar popovers drop down on top of it.
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[var(--workspace-topbar-height)] items-center justify-end gap-2 px-3",
          isElectron && "drag-region",
        )}
      >
        <div ref={setToolbar} className="pointer-events-auto flex items-center gap-2" />
      </div>
      {target !== null ? (
        <div
          ref={panelRef}
          className="absolute top-[calc(var(--workspace-topbar-height)+0.25rem)] right-3 bottom-3 w-[min(var(--resizable-width),calc(100%-4rem))]"
          style={
            {
              [RESIZABLE_WIDTH_PROPERTY]: `${chatWidth.width}px`,
              // The folded sidebar's toggle and window controls sit outside the
              // floating panel, so its header needs no room for them.
              "--workspace-titlebar-content-left": "var(--workspace-gutter)",
            } as CSSProperties
          }
        >
          <RightPanelResizeHandle handlers={chatWidth.handlers} />
          <div className="absolute top-1 -left-10">
            <Button variant="glass" size="icon-sm" aria-label="Close chat" onClick={closePanel}>
              <XIcon />
            </Button>
          </div>
          {/* Framed in the character's colour, so it is clear whose chat this is; the
              white outline keeps the frame visible against the sea and dark themes.
              Layout containment makes the frame the anchor for the chat's fixed
              titlebar controls, so its panel toggles sit at the header's right end. */}
          <div
            className="flex size-full flex-col overflow-hidden rounded-xl border-6 border-border bg-background shadow-xl outline-2 outline-white [contain:layout]"
            style={
              {
                "--workspace-controls-top": "0px",
                // Taller than the app's bar, so the portrait and the project chip over the
                // title get room to breathe.
                "--workspace-topbar-height": "68px",
                "--workspace-controls-right": "0.75rem",
                "--workspace-native-controls-inset": "0px",
                ...(look === null ? {} : { borderColor: palette.families[look.hue]?.base }),
              } as CSSProperties
            }
          >
            <ThreadRouteView target={target} container="bare" />
          </div>
        </div>
      ) : null}
    </SidebarInset>
  );
}
