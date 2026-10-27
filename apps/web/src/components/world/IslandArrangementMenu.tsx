import { Columns3Icon, Grid2x2Icon, Rows3Icon, type LucideIcon } from "lucide-react";

import { Button } from "../ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import type { IslandArrangement } from "./engine/archipelago";
import { useWorldArrangementStore } from "./worldArrangementStore";

export const ARRANGEMENTS: ReadonlyArray<{
  readonly value: IslandArrangement;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { value: "column", label: "Vertical", icon: Rows3Icon },
  { value: "grid", label: "Grid", icon: Grid2x2Icon },
  { value: "row", label: "Horizontal", icon: Columns3Icon },
];

/** Top bar menu that picks how the islands line up: down a column, in a grid, or along a row. */
export function IslandArrangementMenu() {
  const arrangement = useWorldArrangementStore((state) => state.arrangement);
  const setArrangement = useWorldArrangementStore((state) => state.setArrangement);
  const current = ARRANGEMENTS.find((option) => option.value === arrangement) ?? ARRANGEMENTS[0]!;

  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="glass" size="icon-sm" />}
        aria-label={`Island arrangement: ${current.label}`}
        title="Arrange islands"
      >
        <current.icon />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup
          value={arrangement}
          onValueChange={(value) => setArrangement(value as IslandArrangement)}
        >
          {ARRANGEMENTS.map((option) => (
            <MenuRadioItem key={option.value} value={option.value} closeOnClick>
              <span className="flex items-center gap-2">
                <option.icon className="size-4 text-muted-foreground" />
                <span className="flex-1">{option.label}</span>
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
