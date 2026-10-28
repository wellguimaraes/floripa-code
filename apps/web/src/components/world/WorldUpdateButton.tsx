import { DownloadIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "../../env";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../desktopUpdate.logic";
import { confirmAndInstallDesktopUpdate, downloadDesktopUpdate } from "../desktopUpdate.toast";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The world has no sidebar and so no sidebar update pill. This takes its place beside
 * Settings, and shows only while there is an update to download or install.
 */
export function WorldUpdateButton() {
  return isElectron ? <WorldUpdateControl /> : null;
}

function WorldUpdateControl() {
  const state = useDesktopUpdateState();
  const [isActionPending, setIsActionPending] = useState(false);
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const isDownloading = state?.status === "downloading";
  if (state === null || (action === "none" && !isDownloading)) return null;

  const label = isDownloading
    ? `Updating ${Math.floor(state.downloadPercent ?? 0)}%`
    : action === "install"
      ? "Restart to update"
      : "Update";
  const disabled = isActionPending || isDownloading || isDesktopUpdateButtonDisabled(state);

  const handleClick = () => {
    const bridge = window.desktopBridge;
    if (!bridge || disabled) return;
    setIsActionPending(true);
    const run =
      action === "install"
        ? confirmAndInstallDesktopUpdate(bridge, state)
        : downloadDesktopUpdate(bridge);
    void run.finally(() => setIsActionPending(false));
  };

  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="glass" disabled={disabled} onClick={handleClick} />}>
        {action === "install" ? <RotateCwIcon /> : <DownloadIcon />}
        {label}
      </TooltipTrigger>
      <TooltipPopup side="bottom">{getDesktopUpdateButtonTooltip(state)}</TooltipPopup>
    </Tooltip>
  );
}
