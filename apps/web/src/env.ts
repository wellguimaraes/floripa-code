/**
 * True when running inside the Electron preload bridge, false in a regular browser.
 * The preload script sets window.desktopBridge via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isElectron = typeof window !== "undefined" && window.desktopBridge !== undefined;

/** Secret providers are opt-in while they settle: set FLORIPACODE_FEATURE_SECRETS=1 at build or dev time. */
export const isSecretsFeatureEnabled = ["1", "true"].includes(
  import.meta.env.FLORIPACODE_FEATURE_SECRETS?.trim().toLowerCase() ?? "",
);
