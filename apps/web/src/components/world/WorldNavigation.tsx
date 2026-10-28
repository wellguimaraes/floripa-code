import { Link } from "@tanstack/react-router";
import { SearchIcon, SettingsIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The world has no sidebar, so its top bar holds the ways out of the map: the command
 * palette, which reaches every thread, project and page, leads it, and Settings ends it.
 */
export function WorldNavigation() {
  return (
    <div className="surface-glass flex h-9 sm:h-8 items-center gap-0.5 rounded-full border border-border/60 px-1 text-foreground shadow-sm">
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
    </div>
  );
}

/** Settings, on its own at the right end of the world's top bar. */
export function WorldSettingsButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="glass"
            size="icon"
            aria-label="Settings"
            // A link so the router preloads the settings chunks on hover.
            render={<Link to="/settings/general" />}
          />
        }
      >
        <SettingsIcon className="size-4" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">Settings</TooltipPopup>
    </Tooltip>
  );
}
