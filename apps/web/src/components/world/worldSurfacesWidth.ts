import { createContext } from "react";

import type { PreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";

/**
 * The surfaces' width in the world's chat frame. The frame owns it so the chat and the
 * surfaces each keep their width when the other collapses; ChatView sizes its panel from it.
 */
export const WorldSurfacesWidthContext = createContext<PreviewPanelInlineSize | null>(null);
