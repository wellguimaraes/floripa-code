import { createContext, use } from "react";

/**
 * Popups (popovers, menus, selects, comboboxes) float above toasts by default. A surface that
 * dialogs open over, like the world, wraps itself in this context set to true so its popups sit
 * under the dialog layer instead, and a dialog opened while one shows covers it. Dialogs reset
 * it to false so the popups they own stay above them.
 */
export const PopupsBelowDialogsContext = createContext(false);

/** The z-index class for a popup's positioner. */
export function usePopupLayerClassName() {
  return use(PopupsBelowDialogsContext) ? "z-49" : "z-[130]";
}
