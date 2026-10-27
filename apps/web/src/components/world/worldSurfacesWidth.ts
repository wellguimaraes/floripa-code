import { createContext } from "react";

import type { PreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";

/**
 * The surfaces' width in the world's chat frame. The frame owns it so the chat and the
 * surfaces each keep their width when the other collapses; ChatView sizes its panel from it.
 */
export const WorldSurfacesWidthContext = createContext<PreviewPanelInlineSize | null>(null);

/**
 * The surfaces' width once the frame is dragged from `start` to `frameWidth`: the chat and the
 * surfaces scale together until either reaches its minimum, then the other takes the rest.
 */
export function scaleSurfacesWidth(
  frameWidth: number,
  start: { readonly frame: number; readonly surfaces: number },
  minimums: { readonly chat: number; readonly surfaces: number },
): number {
  const scaled = Math.round((start.surfaces * frameWidth) / start.frame);
  return Math.max(minimums.surfaces, Math.min(frameWidth - minimums.chat, scaled));
}
