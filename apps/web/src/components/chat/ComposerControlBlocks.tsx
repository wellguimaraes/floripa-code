import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { resolveRestingComposerControlsLayout } from "../composerFooterLayout";
import { measureRestingComposerControls } from "./restingComposerControlsMeasurement";

export interface ComposerControlBlock {
  readonly id: string;
  readonly content: ReactNode;
}

/**
 * Fits a composer's controls (a model picker, then blocks) to `host`, or to the
 * controls themselves when `useControlsAsHost`: trailing blocks drop their labels
 * first, then move into the overflow menu. Attach `attachControls` to the element
 * holding the picker and `ComposerControlBlocks`.
 */
export function useRestingComposerControlsLayout(
  host: HTMLDivElement | null,
  useControlsAsHost = false,
) {
  const [controls, setControls] = useState<HTMLDivElement | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const attachControls = useCallback((element: HTMLDivElement | null) => {
    controlsRef.current = element;
    setControls(element);
  }, []);
  const hostRef = useRef(host);
  hostRef.current = host;
  const [layout, setLayout] = useState<{
    hiddenCount: number;
    iconOnlyCount?: number;
    visible: boolean;
  }>({ hiddenCount: 0, visible: true });

  const measure = useCallback(() => {
    const currentHost = useControlsAsHost ? controls : hostRef.current;
    if (currentHost === null || !controls) return;

    const measurement = measureRestingComposerControls(controls);
    if (!measurement) return;
    const style = getComputedStyle(currentHost);
    const hostWidth =
      currentHost.clientWidth -
      (Number.parseFloat(style.paddingInlineStart) || 0) -
      (Number.parseFloat(style.paddingInlineEnd) || 0);

    setLayout((current) => {
      const next = resolveRestingComposerControlsLayout({
        ...measurement,
        hostWidth,
        previous: current,
      });
      return next.hiddenCount === current.hiddenCount &&
        next.iconOnlyCount === current.iconOnlyCount &&
        next.visible === current.visible
        ? current
        : next;
    });
  }, [controls, useControlsAsHost]);

  useLayoutEffect(measure, [measure, host]);
  useEffect(() => {
    const currentHost = useControlsAsHost ? controls : host;
    if (!currentHost || !controls) return;
    let stopObserving = () => {};
    const observeControls = () => {
      stopObserving();
      stopObserving = observeResize(
        [
          currentHost,
          controls,
          ...controls.querySelectorAll<HTMLElement>(
            "[data-resting-block], [data-composer-control-label], [data-chat-provider-model-picker-label]",
          ),
        ],
        measure,
      );
      measure();
    };
    observeControls();
    const mutations = new MutationObserver(observeControls);
    mutations.observe(controls, { childList: true, subtree: true, characterData: true });
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      stopObserving();
      mutations.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [host, controls, useControlsAsHost, measure]);

  return {
    controlsRef,
    attachControls,
    hiddenBlockCount: layout.hiddenCount,
    iconOnlyBlockCount: layout.iconOnlyCount ?? 0,
    controlsVisible: layout.visible,
  };
}

/**
 * The blocks after a composer's model picker, laid out as `useRestingComposerControlsLayout`
 * decided: the last `iconOnlyBlockCount` show only icons and the last `hiddenBlockCount`
 * move into the overflow menu, which gets their ids. Hidden blocks and an unused menu stay
 * mounted out of flow so they can still be measured.
 */
export function ComposerControlBlocks(props: {
  readonly blocks: ReadonlyArray<ComposerControlBlock>;
  readonly hiddenBlockCount: number;
  readonly iconOnlyBlockCount: number;
  readonly renderOverflowMenu: (hiddenBlockIds: ReadonlyArray<string>) => ReactNode;
}) {
  const { blocks, hiddenBlockCount, iconOnlyBlockCount } = props;
  const hiddenBlockIds = blocks.slice(blocks.length - hiddenBlockCount).map((block) => block.id);
  return (
    <>
      {blocks.map((block, index) => {
        const hidden = index >= blocks.length - hiddenBlockCount;
        const iconOnly = index >= blocks.length - iconOnlyBlockCount;
        return (
          <div
            key={block.id}
            data-resting-block={block.id}
            data-composer-block-icon-only={iconOnly ? "true" : "false"}
            aria-hidden={hidden || undefined}
            inert={hidden || undefined}
            className={cn(
              "flex w-max min-w-max shrink-0 items-center gap-1",
              hidden && "pointer-events-none invisible absolute",
              iconOnly &&
                "[&_[data-composer-control-label]]:pointer-events-none [&_[data-composer-control-label]]:invisible [&_[data-composer-control-label]]:absolute [&_[data-composer-control-label]]:w-max [&_[data-composer-control-label]]:max-w-none [&_[data-composer-control-compact-icon]]:[visibility:inherit] [&_[data-composer-control-compact-icon]]:relative",
            )}
          >
            {block.content}
          </div>
        );
      })}
      <div
        data-resting-controls-overflow
        aria-hidden={hiddenBlockIds.length === 0 || undefined}
        inert={hiddenBlockIds.length === 0 || undefined}
        className={cn(
          "min-w-0 shrink-0",
          hiddenBlockIds.length === 0 && "pointer-events-none invisible absolute",
        )}
      >
        {props.renderOverflowMenu(hiddenBlockIds)}
      </div>
    </>
  );
}
