import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import {
  Activity,
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
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import { useThreadShell } from "../../state/entities";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { DevOnboardingButton } from "../onboarding/DevOnboardingButton";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { ThreadRouteView } from "../ThreadRouteView";
import { Button } from "../ui/button";
import { SidebarInset, useSidebar } from "../ui/sidebar";
import { ContrastSlider } from "./ContrastSlider";
import { ManagerToggle } from "./ManagerToggle";
import { WORLD_MANAGERS_AVAILABLE } from "./worldManagerStore";
import { TimeSlider } from "./TimeSlider";
import { WeatherToggle } from "./WeatherToggle";
import { WorldNavigation } from "./WorldNavigation";
import { WorldUsageBar } from "./WorldUsageBar";
import { islandWorlds } from "./definitions/island";
import { palette } from "./scene/palette";
import { useWorldModeStore } from "./worldModeStore";
import { WorldSurfacesWidthContext } from "./worldSurfacesWidth";

// three.js and the scene load only when someone opens the world.
const WorldCanvas = lazy(() => import("./WorldCanvas"));

const CHAT_MIN_WIDTH = 400;
const CHAT_DEFAULT_WIDTH = 720;
// The worktree's surfaces, their type rail included.
const SURFACES_MIN_WIDTH = 360;
const SURFACES_DEFAULT_WIDTH = 604;
// The surface-type rail on the frame's right edge, all that shows of closed surfaces.
const RAILS_WIDTH = 44;
// Room left of the chat for its close button (4rem) and right of it for the margin (0.75rem).
const CHAT_GUTTERS = 76;

function readFrameMaxWidth(): number {
  if (typeof window === "undefined") return CHAT_DEFAULT_WIDTH + SURFACES_DEFAULT_WIDTH;
  return window.innerWidth - CHAT_GUTTERS;
}

/**
 * A width in the floating frame, dragged and remembered in this browser. `reserved` is
 * room the frame keeps for whatever shows beside it.
 */
function useFrameWidth(storageKey: string, defaultWidth: number, minWidth: number, reserved = 0) {
  const [frameMaxWidth, setFrameMaxWidth] = useState(readFrameMaxWidth);
  useEffect(() => {
    const onResize = () => setFrameMaxWidth(readFrameMaxWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return useResizableWidth({
    storageKey,
    defaultWidth,
    minWidth,
    maxWidth: Math.max(minWidth, frameMaxWidth - reserved),
    edge: "left",
  });
}

/**
 * The chat layout in world mode. The URL still picks the open thread, so
 * clicking a character navigates to it and its chat floats over the world;
 * everything ChatView does on its own (forks, deletes) keeps working.
 * `covered` is for while Settings sits over the world: the chat hides, and its
 * shortcuts with it, until Settings closes onto it again.
 */
export function WorldLayout({
  target,
  covered,
}: {
  readonly target: ThreadRouteTarget | null;
  readonly covered: boolean;
}) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const readPanel = useCallback(() => panelRef.current, []);
  const topBarRef = useRef<HTMLDivElement>(null);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const readBars = useCallback(
    () => ({ top: topBarRef.current, bottom: bottomBarRef.current }),
    [],
  );
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  // Only real threads open here. A draft (the new-thread creator) never does: the world
  // starts agents from its own bubble, so a draft route shows the world alone.
  const chatTarget = target?.kind === "server" ? target : null;
  const selectedKey = chatTarget ? scopedThreadKey(chatTarget.threadRef) : null;
  // The frame stays mounted, hidden, after its chat closes: reopening it (or another agent,
  // which only changes the chat's props) skips mounting the whole chat and its surfaces.
  // Hidden, React tears down its effects, so its shortcuts and listeners stop with it.
  const [heldTarget, setHeldTarget] = useState(chatTarget);
  if (
    chatTarget !== null &&
    (heldTarget === null || scopedThreadKey(heldTarget.threadRef) !== selectedKey)
  ) {
    setHeldTarget(chatTarget);
  }

  // Opening an agent shows its chat, even one whose worktree's chat was collapsed.
  const openThread = (ref: ScopedThreadRef) => {
    useRightPanelStore.getState().setMaximized(ref, false);
    return navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  const closeChat = () => navigate({ to: "/" });
  // A worktree's hat on the water opens its surfaces alone; the chat can come back from the frame.
  const openSurfaces = (ref: ScopedThreadRef) => {
    const panel = useRightPanelStore.getState();
    panel.show(ref);
    panel.setMaximized(ref, true);
    return navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  const closePanel = () => {
    void closeChat();
  };

  // The chat closes once its agent is archived, from here or anywhere else. One opened
  // already archived (from Settings → Archived, say) stays open.
  const chatThreadRef = chatTarget?.threadRef ?? null;
  const chatThread = useThreadShell(chatThreadRef);
  // The held chat's surfaces size the frame, so it keeps its width while hidden.
  const surfaces = useRightPanelStore((state) =>
    selectThreadRightPanelState(state.byPanelKey, heldTarget?.threadRef ?? null),
  );
  // The frame remembers the surfaces' width and the chat and surfaces together, so collapsing
  // either side leaves the other as wide as it was. The edge drag writes straight to the frame:
  // with the chat shown it moves the chat's side, with the chat collapsed the surfaces'. The
  // divider between them trades width within the frame.
  const chatShown = !(surfaces.isOpen && surfaces.maximized);
  const surfacesWidth = useFrameWidth(
    "floripacode:world-surfaces-width:v2",
    SURFACES_DEFAULT_WIDTH,
    SURFACES_MIN_WIDTH,
    chatShown ? CHAT_MIN_WIDTH : 0,
  );
  const chatAndSurfacesWidth = useFrameWidth(
    "floripacode:world-chat-and-surfaces-width:v1",
    CHAT_DEFAULT_WIDTH + SURFACES_DEFAULT_WIDTH,
    CHAT_MIN_WIDTH + surfacesWidth.width,
  );
  const frameWidth = chatShown ? chatAndSurfacesWidth : surfacesWidth;
  // Closed surfaces leave only their rail beside the chat.
  const frameOffset = chatShown && !surfaces.isOpen ? RAILS_WIDTH - surfacesWidth.width : 0;
  const chatArchived = chatThread !== null && chatThread.archivedAt != null;
  const chatWasArchived = useRef<{ key: string | null; archived: boolean }>({
    key: null,
    archived: false,
  });
  useEffect(() => {
    const was = chatWasArchived.current;
    chatWasArchived.current = { key: selectedKey, archived: chatArchived };
    if (selectedKey !== null && was.key === selectedKey && !was.archived && chatArchived) {
      void navigate({ to: "/" });
    }
  }, [chatArchived, navigate, selectedKey]);

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

  useEffect(() => {
    if (chatTarget === null || covered) return;
    // Cmd+Escape (Ctrl+Escape) closes the panel unless something in it (a menu, picker,
    // dialog) took it first. Plain Escape is left to the chat, so it can't close it by accident.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.repeat) return;
      if (!event.metaKey && !event.ctrlKey) return;
      // The message editor (ProseMirror) prevents every Escape; its menus also stop the event,
      // so one that gets here from the editor was not used.
      const fromEditor = event.target instanceof Element && event.target.closest(".ProseMirror");
      if (event.defaultPrevented && !fromEditor) return;
      event.preventDefault();
      void navigate({ to: "/" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chatTarget, covered, navigate]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
      {/* The sea's blue until the scene fades in over it. */}
      <div className="absolute inset-0" style={{ backgroundColor: palette.loadingSea }}>
        <Suspense fallback={null}>
          <WorldCanvas
            definitions={islandWorlds}
            selectedKey={selectedKey}
            onExpand={openThread}
            onCollapse={closeChat}
            onOpenSurfaces={openSurfaces}
            chatCollapsed={chatTarget !== null && !chatShown}
            panel={readPanel}
            bars={readBars}
            toolbar={toolbar}
          />
        </Suspense>
      </div>
      <div
        ref={topBarRef}
        className={cn(
          // Stacked over the chat panel so toolbar popovers drop down on top of it.
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[var(--workspace-topbar-height)] items-center gap-2 pr-3",
          isElectron && "drag-region",
        )}
        // Clears the window controls on the left. The sidebar stays folded here, so no room
        // is kept for its toggle.
        style={{ paddingLeft: "var(--workspace-controls-left)" }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <WorldNavigation />
          <ContrastSlider />
          <TimeSlider />
          <WeatherToggle />
          {WORLD_MANAGERS_AVAILABLE ? <ManagerToggle /> : null}
          <DevOnboardingButton variant="glass" />
          <div ref={setToolbar} className="flex items-center gap-2" />
        </div>
      </div>
      <div
        ref={bottomBarRef}
        className="pointer-events-none absolute bottom-3 left-3 z-10 flex"
        // Stops short of the open chat, which also sits on the bottom edge.
        style={{
          right:
            chatTarget === null
              ? "0.75rem"
              : `calc(min(${frameWidth.width + frameOffset}px, 100% - 4rem) + 1.5rem)`,
        }}
      >
        <div className="pointer-events-auto min-w-0">
          <WorldUsageBar />
        </div>
      </div>
      {heldTarget !== null ? (
        <Activity mode={chatTarget !== null && !covered ? "visible" : "hidden"}>
          <div
            ref={panelRef}
            className="absolute top-[calc(var(--workspace-topbar-height)+0.25rem)] right-3 bottom-3 w-[min(calc(var(--resizable-width)+var(--world-frame-offset)),calc(100%-4rem))]"
            style={
              {
                [RESIZABLE_WIDTH_PROPERTY]: `${frameWidth.width}px`,
                "--world-frame-offset": `${frameOffset}px`,
                // The folded sidebar's toggle and window controls sit outside the
                // floating panel, so its header needs no room for them.
                "--workspace-titlebar-content-left": "var(--workspace-gutter)",
              } as CSSProperties
            }
          >
            <RightPanelResizeHandle
              handlers={frameWidth.handlers}
              showIndicator={false}
              onDoubleClick={closePanel}
            />
            <div className="absolute top-3 -left-10">
              <Button variant="glass" size="icon-sm" aria-label="Close chat" onClick={closePanel}>
                <XIcon />
              </Button>
            </div>
            {/* Layout containment makes the frame the anchor for the chat's fixed
              titlebar controls. The chat's header moves into its composer here; the
              frame's own header names the project and worktree above everything. */}
            <div
              className="flex size-full flex-col overflow-hidden rounded-xl bg-background shadow-xl [contain:layout]"
              style={
                {
                  "--workspace-controls-top": "0px",
                  "--workspace-topbar-height": "2.5rem",
                  "--workspace-controls-right": "0.75rem",
                  "--workspace-native-controls-inset": "0px",
                } as CSSProperties
              }
            >
              <WorldSurfacesWidthContext value={surfacesWidth}>
                <ThreadRouteView target={heldTarget} container="bare" />
              </WorldSurfacesWidthContext>
            </div>
          </div>
        </Activity>
      ) : null}
    </SidebarInset>
  );
}
