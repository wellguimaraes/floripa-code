import { useRef, useState, type KeyboardEvent } from "react";

import { cn } from "../../lib/utils";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { signTextColor } from "./scene/Sign";

export interface PickableIsland {
  readonly key: string;
  readonly title: string;
  /** The island's sign colour, so each button reads as that island. */
  readonly color: string;
  /** How many piles are free for a new agent; none leaves the button disabled. */
  readonly freePiles: number;
}

/**
 * Asks which island a new agent starts on, for the new-thread shortcut in the
 * world. Big buttons in each island's sign colour; arrow keys move between them,
 * Enter or a click picks one.
 */
export function NewAgentProjectPicker(props: {
  readonly open: boolean;
  readonly islands: ReadonlyArray<PickableIsland>;
  /** The island picked first when it has room, e.g. the one of the agent in focus. */
  readonly defaultKey: string | null;
  readonly onPick: (key: string) => void;
  readonly onClose: () => void;
}) {
  const { open, islands, defaultKey, onPick, onClose } = props;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPopup
        className="max-w-xl"
        showCloseButton={false}
        // The new-agent bubble takes focus once picked; nothing to hand it back to.
        finalFocus={false}
      >
        {/* The popup unmounts once closed, so each opening starts on the default island. */}
        <IslandButtons islands={islands} defaultKey={defaultKey} onPick={onPick} />
      </DialogPopup>
    </Dialog>
  );
}

function IslandButtons(props: {
  readonly islands: ReadonlyArray<PickableIsland>;
  readonly defaultKey: string | null;
  readonly onPick: (key: string) => void;
}) {
  const { islands, defaultKey, onPick } = props;
  const columns = islands.length <= 4 ? 2 : 3;
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [active, setActive] = useState(() => {
    const preferred = islands.findIndex(
      (island) => island.key === defaultKey && island.freePiles > 0,
    );
    return preferred !== -1
      ? preferred
      : Math.max(
          0,
          islands.findIndex((island) => island.freePiles > 0),
        );
  });

  const move = (event: KeyboardEvent) => {
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
            ? columns
            : event.key === "ArrowUp"
              ? -columns
              : 0;
    if (step === 0) return;
    event.preventDefault();
    // Full islands are skipped: their buttons cannot take focus.
    let next = active + step;
    while (next >= 0 && next < islands.length && islands[next]!.freePiles === 0) next += step;
    if (next < 0 || next >= islands.length) return;
    setActive(next);
    buttons.current[next]?.focus();
  };

  return (
    <div className="flex flex-col gap-4 p-5" onKeyDown={move}>
      <div className="flex flex-col gap-1">
        <DialogTitle>New agent</DialogTitle>
        <DialogDescription>Pick the island it works on.</DialogDescription>
      </div>
      {islands.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every island is hidden from the map.</p>
      ) : (
        <div
          className={cn(
            "grid gap-2.5",
            columns === 2 && "grid-cols-2",
            columns === 3 && "grid-cols-3",
          )}
        >
          {islands.map((island, index) => {
            const full = island.freePiles === 0;
            return (
              <button
                key={island.key}
                ref={(button) => {
                  buttons.current[index] = button;
                }}
                type="button"
                autoFocus={index === active}
                tabIndex={index === active ? 0 : -1}
                disabled={full}
                onFocus={() => setActive(index)}
                onClick={() => onPick(island.key)}
                className={cn(
                  "flex h-20 min-w-0 flex-col items-start justify-center gap-0.5 rounded-xl px-4 text-left",
                  "outline-none transition-transform hover:scale-[1.03]",
                  // Marks the arrow keys' place from the start, not only after a key press.
                  index === active && !full && "scale-[1.03] ring-4 ring-black/35 ring-inset",
                  full && "cursor-not-allowed opacity-40 hover:scale-100",
                )}
                style={{ backgroundColor: island.color, color: signTextColor(island.color) }}
              >
                <span className="w-full truncate text-base font-semibold">{island.title}</span>
                <span className="text-xs opacity-75">
                  {full
                    ? "No free spot"
                    : `${island.freePiles} free ${island.freePiles === 1 ? "spot" : "spots"}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Arrows to move · Enter to pick · Esc to close</p>
    </div>
  );
}
