import { useMatch } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";

import { useIsMobile } from "../../hooks/useMediaQuery";
import type { ThreadRouteTarget } from "../../threadRoutes";
import { threadRouteTargetKey, useWorldRoute } from "./worldRoute";
import { palette } from "./scene/palette";

const WorldLayout = lazy(() =>
  import("./WorldLayout").then((module) => ({ default: module.WorldLayout })),
);

/**
 * The world, mounted from the app shell rather than the chat route so it outlives the trip into
 * Settings: opened from the world, Settings shows as a dialog over it, and closing it finds the
 * camera and the open chat where they were. Settings opened from anywhere else stays a page.
 */
export function WorldHost() {
  const { worldMode, target } = useWorldRoute();
  // Matches, like `useWorldRoute`, so leaving Settings for the world never sees neither for a render.
  const onSettings =
    useMatch({ from: "/settings", shouldThrow: false, select: () => true }) ?? false;
  const wide = !useIsMobile();
  // The world's last route, held while Settings covers it.
  const [held, setHeld] = useState<{ readonly target: ThreadRouteTarget | null } | null>(null);
  if (worldMode) {
    if (held === null || threadRouteTargetKey(held.target) !== threadRouteTargetKey(target)) {
      setHeld({ target });
    }
  } else if (held !== null && !(onSettings && wide)) {
    setHeld(null);
  }
  const shown = worldMode ? { target } : held;
  if (shown === null) return null;
  return (
    <Suspense
      fallback={<div className="fixed inset-0" style={{ backgroundColor: palette.loadingSea }} />}
    >
      <WorldLayout target={shown.target} covered={!worldMode} />
    </Suspense>
  );
}
