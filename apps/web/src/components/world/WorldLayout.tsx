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
import { islandWorlds } from "./definitions/island";
import { useWorldModeStore } from "./worldModeStore";

// three.js and the scene load only when someone opens the world.
const WorldCanvas = lazy(() => import("./WorldCanvas"));

const CHAT_MIN_WIDTH = 400;
const CHAT_DEFAULT_WIDTH = 720;
// The frame grows by this much while the worktree's surfaces show beside the chat.
const SURFACES_WIDTH = 560;
// The surface-type rail on the frame's right edge.
const RAILS_WIDTH = 44;
// Room left of the chat for its close button (4rem) and right of it for the margin (0.75rem).
const CHAT_GUTTERS = 76;

function readChatMaxWidth(): number {
  if (typeof window === "undefined") return CHAT_DEFAULT_WIDTH;
  return Math.max(CHAT_MIN_WIDTH, window.innerWidth - CHAT_GUTTERS);
}

/**
 * A width for the floating frame, dragged from its left edge and remembered in this browser.
 * The chat and the surfaces shown alone each keep their own.
 */
function useFrameWidth(storageKey: string, defaultWidth: number) {
  const [maxWidth, setMaxWidth] = useState(readChatMaxWidth);
  useEffect(() => {
    const onResize = () => setMaxWidth(readChatMaxWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return useResizableWidth({
    storageKey,
    defaultWidth,
    minWidth: CHAT_MIN_WIDTH,
    maxWidth,
    edge: "left",
  });
}

/**
 * The chat layout in world mode. The URL still picks the open thread, so
 * clicking a character navigates to it and its chat floats over the world;
 * everything ChatView does on its own (forks, deletes) keeps working.
 */
export function WorldLayout({ target }: { readonly target: ThreadRouteTarget | null }) {
  const navigate = useNavigate();
  const panelRef = useRef<HTMLDivElement>(null);
  const readPanel = useCallback(() => panelRef.current, []);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const chatWidth = useFrameWidth("t3code:world-chat-width:v1", CHAT_DEFAULT_WIDTH);
  const surfacesOnlyWidth = useFrameWidth(
    "t3code:world-surfaces-width:v1",
    SURFACES_WIDTH + RAILS_WIDTH,
  );
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

  // Picking an agent always shows its chat, even one whose worktree's chat was collapsed.
  const openThread = (ref: ScopedThreadRef) => {
    useRightPanelStore.getState().setMaximized(ref, false);
    return navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  const closeChat = () => navigate({ to: "/" });
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
  // The drag writes its width straight to the frame. With the chat shown it sizes the chat
  // and the surfaces add theirs beside it; with the chat collapsed it sizes the surfaces
  // alone, from a width of their own, so it never moves a width that is not on screen.
  const chatShown = !(surfaces.isOpen && surfaces.maximized);
  const frameWidth = chatShown ? chatWidth : surfacesOnlyWidth;
  const surfacesWidth = chatShown ? (surfaces.isOpen ? SURFACES_WIDTH : 0) + RAILS_WIDTH : 0;
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
    if (chatTarget === null) return;
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
  }, [chatTarget, navigate]);

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden md:h-dvh">
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          <WorldCanvas
            definitions={islandWorlds}
            selectedKey={selectedKey}
            onExpand={openThread}
            onCollapse={closeChat}
            panel={readPanel}
            toolbar={toolbar}
          />
        </Suspense>
      </div>
      <div
        className={cn(
          // Stacked over the chat panel so toolbar popovers drop down on top of it.
          "pointer-events-none absolute inset-x-0 top-0 z-10 flex h-[var(--workspace-topbar-height)] items-center gap-2 pr-3",
          isElectron && "drag-region",
        )}
        // Clears the window controls on the left.
        style={{ paddingLeft: "var(--workspace-titlebar-content-left)" }}
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <WorldNavigation />
          <ContrastSlider />
          <TimeSlider />
          <WeatherToggle />
          {WORLD_MANAGERS_AVAILABLE ? <ManagerToggle /> : null}
          <div ref={setToolbar} className="flex items-center gap-2" />
        </div>
      </div>
      {heldTarget !== null ? (
        <Activity mode={chatTarget !== null ? "visible" : "hidden"}>
          <div
            ref={panelRef}
            className="absolute top-[calc(var(--workspace-topbar-height)+0.25rem)] right-3 bottom-3 w-[min(calc(var(--resizable-width)+var(--world-surfaces-width)),calc(100%-4rem))]"
            style={
              {
                [RESIZABLE_WIDTH_PROPERTY]: `${frameWidth.width}px`,
                "--world-surfaces-width": `${surfacesWidth}px`,
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
              <ThreadRouteView target={heldTarget} container="bare" />
            </div>
          </div>
        </Activity>
      ) : null}
    </SidebarInset>
  );
}
