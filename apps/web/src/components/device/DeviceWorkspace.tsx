import type { DeviceSummary, EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";
import {
  captureDeviceScreenshot,
  DeviceScreenshotError,
} from "@t3tools/client-runtime/device/screenshot";
import { refreshDeviceHubAccess, useDeviceHubAccess } from "~/state/device";
import { DeviceControlsRail } from "./DeviceControlsRail";
import {
  DeviceStreamView,
  type DeviceStreamHandle,
  type DeviceViewControls,
} from "./DeviceStreamView";
import { DeviceToolsPanel } from "./DeviceToolsPanel";
import { useDeviceControls } from "./useDeviceControls";

/** Keyed by environment and device; the screen, quick controls and drawer share the same session. */
export function DeviceWorkspace(props: {
  environmentId: EnvironmentId;
  device: DeviceSummary;
  hostLabel: string;
  hostDiagnostics: string | undefined;
  /** The simulator's serve-sim page on the host's loopback, shown instead of the hub stream. */
  previewUrl?: string | undefined;
  visible: boolean;
  onFloat?: (() => void) | undefined;
  onClose: () => void;
  onPowerOff: () => void;
}) {
  const [handle, setHandle] = useState<DeviceStreamHandle | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [axOverlay, setAxOverlay] = useState(false);
  const [screenshotPending, setScreenshotPending] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const captureRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<string | null>(null);
  const access = useDeviceHubAccess(props.environmentId, props.device.hostId);
  const controls = useDeviceControls({ ...props, access });
  useEffect(() => {
    if (!access || !props.visible) captureRef.current?.abort();
    return () => {
      captureRef.current?.abort();
      if (downloadRef.current) URL.revokeObjectURL(downloadRef.current);
      downloadRef.current = null;
    };
  }, [access, props.visible]);
  const saveScreenshot = () => {
    if (!access || captureRef.current || !props.visible) return;
    const controller = new AbortController();
    captureRef.current = controller;
    setScreenshotPending(true);
    setScreenshotError(null);
    return captureDeviceScreenshot(
      { access, platform: props.device.platform, deviceId: props.device.id },
      controller.signal,
    )
      .then((image) => {
        if (controller.signal.aborted) return;
        if (downloadRef.current) URL.revokeObjectURL(downloadRef.current);
        const url = URL.createObjectURL(image);
        downloadRef.current = url;
        const link = document.createElement("a");
        link.href = url;
        link.download = `${props.device.name.replace(/[^a-z0-9-]/gi, "-")}-${Date.now()}.png`;
        document.body.append(link);
        link.click();
        link.remove();
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          if (cause instanceof DeviceScreenshotError && cause.status === 401)
            refreshDeviceHubAccess(props.environmentId);
          setScreenshotError(
            cause instanceof Error ? cause.message : "Screenshot capture failed. Try again.",
          );
        }
      })
      .finally(() => {
        if (captureRef.current === controller) {
          captureRef.current = null;
          setScreenshotPending(false);
        }
      });
  };
  const rail = (view: DeviceViewControls | null) => (
    <DeviceControlsRail
      platform={props.device.platform}
      handle={handle}
      view={view}
      controls={controls}
      screenshotPending={screenshotPending}
      onScreenshot={() => void saveScreenshot()}
      toolsOpen={toolsOpen}
      onTools={() => setToolsOpen(!toolsOpen)}
      onFloat={props.onFloat}
      onClose={props.onClose}
      onPowerOff={props.onPowerOff}
    />
  );
  return (
    <>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {screenshotError || (controls.error && !toolsOpen) ? (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            {screenshotError ?? controls.error}
          </p>
        ) : null}
        <div className="relative min-h-0 flex-1">
          {props.previewUrl ? (
            <>
              {/* Unmounted while hidden so the page stops streaming. */}
              {props.visible ? (
                // oxlint-disable-next-line react/iframe-missing-sandbox -- the page needs its own origin for its API and input socket; it is cross-origin to the app.
                <iframe
                  src={props.previewUrl}
                  title={`${props.device.name} simulator`}
                  allow="clipboard-read; clipboard-write; fullscreen"
                  className="size-full border-0"
                />
              ) : null}
              {rail(null)}
            </>
          ) : (
            <DeviceStreamView
              environmentId={props.environmentId}
              platform={props.device.platform}
              deviceName={props.device.name}
              deviceDescription={`${props.hostLabel} · ${props.device.version}`}
              deviceId={props.device.id}
              hostId={props.device.hostId}
              visible={props.visible}
              axOverlay={axOverlay}
              allowPhoneView
              onHandle={setHandle}
              renderControls={rail}
            />
          )}
        </div>
      </div>
      {toolsOpen ? (
        <DeviceToolsPanel
          device={props.device}
          controls={controls}
          hostDiagnostics={props.hostDiagnostics}
          access={access}
          axOverlay={axOverlay}
          onAxOverlayChange={setAxOverlay}
          onClose={() => setToolsOpen(false)}
          className="absolute inset-y-0 right-0 z-10 w-full max-w-72 border-l shadow-lg @[700px]:static @[700px]:w-72 @[700px]:shrink-0 @[700px]:shadow-none"
        />
      ) : null}
    </>
  );
}
