import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import {
  OPEN_NOTIFICATION_SETTINGS_CHANNEL,
  REQUEST_NOTIFICATION_PERMISSION_CHANNEL,
} from "../channels.ts";

/**
 * Chromium answers the renderer's `Notification.requestPermission()` itself, so
 * macOS is only asked on the first real notification. That usually lands while
 * the window is unfocused and the prompt goes unseen. Posting one now, while the
 * user is choosing the setting, makes macOS ask in front of them.
 *
 * Resolves false only when macOS refuses. An unanswered prompt resolves true so
 * the setting is not held hostage by it.
 */
export const requestNotificationPermission = DesktopIpc.makeIpcMethod({
  channel: REQUEST_NOTIFICATION_PERMISSION_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.requestNotificationPermission")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.platform !== "darwin" || !Electron.Notification.isSupported()) return true;
    const shown = yield* Effect.callback<boolean>((resume) => {
      const notification = new Electron.Notification({
        title: "Notifications are on",
        body: "Floripa Code will alert you when a thread finishes or needs you.",
        silent: true,
      });
      notification.once("show", () => resume(Effect.succeed(true)));
      notification.once("failed", () => resume(Effect.succeed(false)));
      notification.show();
      return Effect.sync(() => notification.removeAllListeners());
    }).pipe(Effect.timeoutOption("1 minute"));
    return Option.getOrElse(shown, () => true);
  }),
});

/**
 * Electron cannot read whether the OS allows our notifications, so the
 * settings screen offers a way to the OS switch instead. On macOS a packaged
 * build opens its own entry; dev builds use a per-checkout bundle id and land
 * on the app list.
 */
export const openNotificationSettings = DesktopIpc.makeIpcMethod({
  channel: OPEN_NOTIFICATION_SETTINGS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.openNotificationSettings")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const url =
      environment.platform === "darwin"
        ? `x-apple.systempreferences:com.apple.Notifications-Settings.extension${
            environment.isPackaged ? `?id=${environment.appUserModelId}` : ""
          }`
        : environment.platform === "win32"
          ? "ms-settings:notifications"
          : null;
    if (url === null) return false;
    return yield* Effect.promise(() =>
      Electron.shell.openExternal(url).then(
        () => true,
        () => false,
      ),
    );
  }),
});
