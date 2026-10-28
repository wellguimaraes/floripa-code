import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  NOTIFICATION_MODE_LABELS,
  playNotificationSound,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  // Uses the same sound and system notification a thread would, without the
  // focus check, so the user can see what macOS or the browser lets through.
  const sendTest = async () => {
    setPermissionMessage(null);
    if (hasNotificationSound(mode)) {
      await unlockNotificationAudio();
      void playNotificationSound("completion", () => true);
    }
    if (!hasDesktopNotifications(mode)) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      setPermissionMessage(
        "Notifications are not allowed. Choose this option again to grant permission.",
      );
      return;
    }
    try {
      const notification = new Notification("Thread completed", {
        body: "This is a test notification.",
        silent: true,
      });
      notification.addEventListener("error", () =>
        setPermissionMessage(
          "The system blocked the test notification. Allow Floripa Code in your system notification settings.",
        ),
      );
    } catch {
      setPermissionMessage("Notifications are unavailable in this browser.");
    }
  };

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        "System alerts when a thread finishes, fails, or needs input or approval. Applies to this device while Floripa Code is open."
      }
      control={
        <>
          <Select
            value={mode}
            disabled={requesting}
            onValueChange={async (value) => {
              if (
                value !== "off" &&
                value !== "notifications" &&
                value !== "sound" &&
                value !== "notifications-and-sound"
              )
                return;
              setPermissionMessage(null);
              if (hasNotificationSound(value)) unlockNotificationAudio();
              if (hasDesktopNotifications(value)) {
                if (typeof Notification === "undefined" || !window.isSecureContext) {
                  setPermissionMessage(
                    "Notifications need a supported browser over HTTPS, or the desktop app. Sound only is still available.",
                  );
                  return;
                }
                setRequesting(true);
                try {
                  const permission = await Notification.requestPermission();
                  if (
                    permission !== "granted" ||
                    (await window.desktopBridge?.requestNotificationPermission?.()) === false
                  ) {
                    setPermissionMessage(
                      "Allow notifications in your browser or system settings, then choose this option again. Sound only is still available.",
                    );
                    return;
                  }
                } catch {
                  setPermissionMessage(
                    "Notifications are unavailable in this browser. Sound only is still available.",
                  );
                  return;
                } finally {
                  setRequesting(false);
                }
              }
              updateSettings({ notificationMode: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
              <SelectValue>{NOTIFICATION_MODE_LABELS[mode]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {Object.entries(NOTIFICATION_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} hideIndicator value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={mode === "off" || requesting}
            onClick={() => void sendTest()}
          >
            Test
          </Button>
        </>
      }
    />
  );
}
