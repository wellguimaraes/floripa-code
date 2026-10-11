import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon, XIcon } from "lucide-react";
import { Suspense, lazy, useCallback, useEffect, useRef } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { buildThreadRouteParams, type ThreadRouteTarget } from "../../threadRoutes";
import { ThreadRouteView } from "../ThreadRouteView";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { islandWorld } from "./definitions/island";
import { useWorldModeStore } from "./worldModeStore";

// three.js and the scene load only when someone opens the world.
const WorldCanvas = lazy(() => import("./WorldCanvas"));

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
  const selectedKey = target?.kind === "server" ? scopedThreadKey(target.threadRef) : null;

  const openThread = (ref: ScopedThreadRef) => {
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };
  const closePanel = () => {
    void navigate({ to: "/" });
  };

  useEffect(() => {
    if (target === null) return;
    // Escape inside the chat belongs to the chat (menus, composer); outside it closes the panel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
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
            definition={islandWorld}
            selectedKey={selectedKey}
            onExpand={openThread}
            panel={readPanel}
          />
        </Suspense>
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 flex h-[var(--workspace-topbar-height)] items-center justify-end gap-2 px-3",
          isElectron && "drag-region",
          // An open chat pins its panel toggles to the window's top-right corner.
          target !== null && "pr-36",
        )}
      >
        <div className="pointer-events-auto">
          <Button variant="glass" size="sm" onClick={() => setWorldMode(false)}>
            <MessagesSquareIcon />
            Leave world
          </Button>
        </div>
      </div>
      {target !== null ? (
        <div
          ref={panelRef}
          className="absolute top-[calc(var(--workspace-topbar-height)+0.25rem)] right-3 bottom-3 w-[min(720px,calc(100%-4rem))]"
        >
          <div className="absolute top-1 -left-10">
            <Button variant="glass" size="icon-sm" aria-label="Close chat" onClick={closePanel}>
              <XIcon />
            </Button>
          </div>
          <div className="flex size-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl">
            <ThreadRouteView target={target} container="bare" />
          </div>
        </div>
      ) : null}
    </SidebarInset>
  );
}
