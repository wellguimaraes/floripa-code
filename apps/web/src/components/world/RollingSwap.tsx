import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

const ROLL_MS = 280;

interface Shown {
  readonly key: string;
  readonly node: ReactNode;
  readonly leaving: { readonly key: string; readonly node: ReactNode } | null;
}

/**
 * Swaps its content like a message ticker: when `swapKey` changes, the old
 * content rolls up and out while the new one rolls up into place, and the box
 * eases to the new content's size. Content for a given key is treated as fixed.
 */
export function RollingSwap(props: { readonly swapKey: string; readonly children: ReactNode }) {
  const { swapKey, children } = props;
  const [shown, setShown] = useState<Shown>({ key: swapKey, node: children, leaving: null });
  if (shown.key !== swapKey) {
    setShown({ key: swapKey, node: children, leaving: { key: shown.key, node: shown.node } });
  }

  const box = useRef<HTMLDivElement>(null);
  const size = useRef<{ readonly key: string; readonly width: number; readonly height: number }>(
    null,
  );
  // The box follows its content; animate from the old content's size to the new one's.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const previous = size.current;
    if (previous?.key === shown.key) return;
    for (const animation of element.getAnimations()) animation.cancel();
    const next = { key: shown.key, width: element.offsetWidth, height: element.offsetHeight };
    size.current = next;
    if (previous === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.animate(
      [
        { width: `${previous.width}px`, height: `${previous.height}px` },
        { width: `${next.width}px`, height: `${next.height}px` },
      ],
      { duration: ROLL_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" },
    );
  }, [shown.key]);

  const rolling = shown.leaving !== null;
  return (
    <div ref={box} className="relative min-w-0 overflow-hidden">
      <div
        key={`in:${swapKey}`}
        className={rolling ? "flex flex-col motion-safe:animate-world-roll-in" : "flex flex-col"}
      >
        {children}
      </div>
      {shown.leaving !== null ? (
        <div
          key={`out:${shown.leaving.key}`}
          aria-hidden
          className="absolute inset-x-0 top-0 flex flex-col motion-safe:animate-world-roll-out motion-reduce:hidden"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) {
              setShown((current) => ({ ...current, leaving: null }));
            }
          }}
        >
          {shown.leaving.node}
        </div>
      ) : null}
    </div>
  );
}

/** Three dots that blink in turn: the agent is writing. */
export function TypingDots() {
  return (
    <span className="flex h-4 items-center gap-1" role="status" aria-label="Agent is working">
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          className="size-1.5 rounded-full bg-current opacity-35 motion-safe:animate-world-typing-dot"
          style={{ animationDelay: `${dot * 200}ms` }}
        />
      ))}
    </span>
  );
}
