import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useMatch, useParams } from "@tanstack/react-router";

import { useIsMobile } from "../../hooks/useMediaQuery";
import { resolveThreadRouteTarget, type ThreadRouteTarget } from "../../threadRoutes";

/**
 * Whether this route shows the world, and the thread it opens. The world stands in for threads
 * and the landing page wherever its map fits; phones and narrow windows keep the plain thread
 * view, and other chat pages such as pull requests still render normally.
 */
export function useWorldRoute(): {
  readonly worldMode: boolean;
  readonly target: ThreadRouteTarget | null;
} {
  const target = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  // Read the landing match, not the location: the location changes before the
  // matches do, and rendering the landing Outlet for that one render starts a
  // draft that replaces the thread being opened.
  const onLanding = useMatch({ from: "/_chat/", shouldThrow: false, select: () => true }) ?? false;
  const worldMode = !useIsMobile() && (Boolean(target) || onLanding);
  return { worldMode, target: target ?? null };
}

/** Tells two route targets apart without comparing objects. */
export function threadRouteTargetKey(target: ThreadRouteTarget | null): string | null {
  if (target === null) return null;
  return target.kind === "server"
    ? scopedThreadKey(target.threadRef)
    : `draft:${String(target.draftId)}`;
}
