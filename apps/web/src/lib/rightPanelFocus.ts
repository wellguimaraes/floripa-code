const RIGHT_PANEL_SELECTOR = "[data-right-panel-tabbar], [data-right-panel-surface-content]";

let pointerInRightPanel = false;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      pointerInRightPanel =
        event.target instanceof Element && event.target.closest(RIGHT_PANEL_SELECTOR) !== null;
    },
    true,
  );
}

/**
 * Whether the user is working in a right-panel surface (terminal, browser, file, …)
 * rather than the chat. Focus decides when an element holds it; a click into a
 * surface's static content leaves focus on the body, so the last click decides then.
 */
export function isRightPanelFocused(): boolean {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body && active.isConnected) {
    return active.closest(RIGHT_PANEL_SELECTOR) !== null;
  }
  return pointerInRightPanel;
}
