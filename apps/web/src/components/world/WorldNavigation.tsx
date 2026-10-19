import { useNavigate } from "@tanstack/react-router";
import { SearchIcon, SettingsIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The world has no sidebar, so its top bar leads with the ways out of the map: the command
 * palette, which reaches every thread, project and page, and Settings.
 */
export function WorldNavigation() {
  const navigate = useNavigate();
  return (
    <div className="surface-glass flex h-8 items-center gap-0.5 rounded-full border border-border/60 px-1 text-foreground shadow-sm">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Search threads, projects and commands"
              onClick={() => openCommandPalette()}
            />
          }
        >
          <SearchIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Search threads, projects and commands</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Settings"
              onClick={() => void navigate({ to: "/settings" })}
            />
          }
        >
          <SettingsIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Settings</TooltipPopup>
      </Tooltip>
    </div>
  );
}
