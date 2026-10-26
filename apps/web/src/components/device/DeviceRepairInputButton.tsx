import type { EnvironmentId } from "@t3tools/contracts";
import { Wrench } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { requestConfirmDialog } from "~/confirmDialog";
import type { RightPanelSurface } from "~/rightPanelStore";
import { deviceEnvironment, useDeviceState } from "~/state/device";
import { useAtomCommand } from "~/state/use-atom-command";

/**
 * Tab strip shortcut for `repairInput` on the active iOS simulator tab. Same action as
 * Tools → Input → Repair, for when taps or typing stop reaching the simulator.
 */
export function DeviceRepairInputButton(props: {
  readonly environmentId: EnvironmentId;
  readonly surface: Extract<RightPanelSurface, { kind: "device" }>;
}) {
  const target = props.surface.target;
  const { state } = useDeviceState(props.environmentId);
  const runAction = useAtomCommand(deviceEnvironment.action);
  const [pending, setPending] = useState(false);
  const device = target
    ? state.devices.find((entry) => entry.hostId === target.hostId && entry.id === target.deviceId)
    : undefined;
  if (!target || device?.platform !== "ios" || !device.booted) return null;

  const repair = async (anchor: Element) => {
    const confirmed =
      (await requestConfirmDialog(
        "Repair simulator input?\nUse this when taps or typing stop reaching the simulator. It restarts the simulator's home screen and closes running apps.",
        { anchor },
      )) ?? true;
    if (!confirmed) return;
    setPending(true);
    await runAction({
      environmentId: props.environmentId,
      input: { hostId: target.hostId, deviceId: target.deviceId, type: "repairInput" },
    }).finally(() => setPending(false));
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label="Repair simulator input"
            className="shrink-0"
            size="icon-xs"
            variant="ghost-muted"
            disabled={pending}
            onClick={(event) => void repair(event.currentTarget)}
          />
        }
      >
        {pending ? <Spinner size="sm" /> : <Wrench className="size-3.5" />}
      </TooltipTrigger>
      <TooltipPopup>Repair simulator input</TooltipPopup>
    </Tooltip>
  );
}
