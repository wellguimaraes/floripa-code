import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, use } from "react";

import { cn } from "~/lib/utils";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ComposerControlSize } from "./ComposerControl";
import { DockedPickerContext } from "./ProviderModelPicker";
import {
  buildTraitsTriggerDisplay,
  getTraitsSectionVisibility,
  type TraitsSelectionInput,
  useTraitsSelection,
} from "./TraitsPicker";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;

/**
 * What the model trigger shows after the model name: the effort word and the other traits the
 * model reports, such as speed or a context window.
 */
export function describeComposerEffort(
  traits: TraitsSelectionInput | null,
  size: ComposerControlSize,
): { suffix: ReactNode; label: string | null } {
  if (!traits) return { suffix: null, label: null };
  const visibility = getTraitsSectionVisibility(traits);
  if (!visibility.hasAnyControls) return { suffix: null, label: null };
  const { label } = buildTraitsTriggerDisplay({
    provider: traits.provider,
    descriptors: visibility.descriptors,
    primarySelectDescriptorId: visibility.primarySelectDescriptor?.id ?? null,
    ultrathinkPromptControlled: visibility.ultrathinkPromptControlled,
    modelSelection:
      traits.instanceId && traits.model
        ? { instanceId: traits.instanceId, model: traits.model, options: traits.modelOptions ?? [] }
        : null,
    reportedModelSelection: traits.reportedModelSelection,
  });
  if (!label) return { suffix: null, label: null };
  return {
    label,
    suffix: (
      <span
        data-composer-control-label
        className={cn(
          "max-w-32 shrink-0 truncate text-muted-foreground",
          "group-hover/model-trigger:text-foreground group-data-popup-open/model-trigger:text-foreground",
          size === "xs" && "text-xs",
        )}
      >
        {label}
      </span>
    ),
  };
}

const ROW =
  "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-64";
const LABEL = "px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs";

function LevelRow(props: {
  label: string;
  description?: string | undefined;
  selected: boolean;
  /** The group's one tab stop: the selected level, else the first. */
  tabStop: boolean;
  isDefault?: boolean | undefined;
  disabled?: boolean;
  onPick: () => void;
}) {
  const rowProps = {
    type: "button",
    role: "radio",
    "aria-checked": props.selected,
    disabled: props.disabled,
    "data-effort-row": true,
    // Focus lands on a level after a model pick.
    "data-effort-level": true,
    tabIndex: props.tabStop ? 0 : -1,
    className: ROW,
    onClick: props.onPick,
  } as const;
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.selected ? (
        <>
          {props.isDefault ? <span className="sr-only">Default</span> : null}
          <CheckIcon aria-hidden="true" className="size-3.5" />
        </>
      ) : props.isDefault ? (
        <span className="text-muted-foreground/70 text-xs">Default</span>
      ) : null}
    </>
  );
  if (!props.description) return <button {...rowProps}>{content}</button>;
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...rowProps} />}>{content}</TooltipTrigger>
      <TooltipPopup side="right" className="max-w-56">
        {props.description}
      </TooltipPopup>
    </Tooltip>
  );
}

function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  if (event.key === "ArrowLeft") {
    // Back to the model list.
    const search = event.currentTarget
      .closest("[data-model-picker-docked]")
      ?.querySelector<HTMLElement>("[data-model-picker-content] input");
    if (!search) return;
    event.preventDefault();
    event.stopPropagation();
    search.focus();
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-effort-row]:not(:disabled)"),
  );
  const index = rows.findIndex((row) => row === document.activeElement);
  const next =
    rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))];
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

function EffortLevels(props: { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(props.traits);
  if (traits.modelIsUnavailable) {
    return (
      <>
        {traits.descriptors.map((descriptor) => {
          const value = traits.currentLabel(descriptor);
          return value ? (
            <div key={descriptor.id}>
              <div className={LABEL}>{descriptor.label}</div>
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">{value}</div>
            </div>
          ) : null;
        })}
      </>
    );
  }
  if (!traits.hasAnyControls) return <NoEffortRow />;
  const selects: ReadonlyArray<SelectDescriptor> = traits.selectDescriptors;
  return (
    <>
      {selects.map((descriptor, groupIndex) => {
        const value = traits.selectValue(descriptor);
        // Ultrathink in the prompt locks the first group.
        const locked =
          descriptor.id === traits.primarySelectDescriptor?.id && traits.ultrathinkInBodyText;
        const shown = descriptor.options.some((option) => option.id === value);
        return (
          <div
            key={descriptor.id}
            role="radiogroup"
            aria-label={descriptor.label}
            className={cn(
              "flex flex-col gap-0.5",
              groupIndex > 0 && "mt-1 border-t border-border/70 pt-1",
            )}
          >
            <div className={LABEL}>{descriptor.label}</div>
            {locked ? (
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
                Your prompt contains &quot;ultrathink&quot; in the text. Remove it to change this
                option.
              </div>
            ) : null}
            {descriptor.options.map((option, index) => (
              <LevelRow
                key={option.id}
                label={option.label}
                selected={option.id === value}
                tabStop={shown ? option.id === value : index === 0}
                description={option.description}
                isDefault={option.isDefault}
                disabled={locked}
                onPick={() => traits.changeSelect(descriptor, option.id)}
              />
            ))}
          </div>
        );
      })}
      {traits.booleanDescriptors.map((descriptor, index) => {
        const checked = descriptor.currentValue === true;
        return (
          <label
            key={descriptor.id}
            className={cn(
              ROW,
              "has-focus-visible:bg-foreground/[0.09]",
              (selects.length > 0 || index > 0) && "mt-1",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{descriptor.label}</span>
            <Switch
              size="sm"
              checked={checked}
              onCheckedChange={(next) => traits.changeBoolean(descriptor.id, next)}
              aria-label={descriptor.label}
              data-effort-row
              tabIndex={selects.length === 0 && index === 0 ? 0 : -1}
            />
          </label>
        );
      })}
    </>
  );
}

function NoEffortRow() {
  return (
    <div className="flex h-8 items-center px-2 text-muted-foreground text-sm">No effort levels</div>
  );
}

/** The model picker's effort column: the selected model's levels and its other options. */
export function ComposerEffortColumn(props: { traits: TraitsSelectionInput | null }) {
  const picker = use(DockedPickerContext);
  return (
    <div
      data-model-picker-effort
      className="flex max-h-86.5 w-44 shrink-0 flex-col border-l border-border/70"
    >
      <div className="shrink-0 px-3 pt-2.5">
        <div className="flex h-8 items-center gap-2 border-b border-border/70 pb-1.5 text-sm">
          <span className="text-muted-foreground">Effort</span>
          <span className="ms-auto min-w-0 truncate text-muted-foreground text-xs">
            {picker.modelLabel}
          </span>
        </div>
      </div>
      <div
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-2 pt-2.5 pb-1.5"
        onKeyDown={moveBetweenRows}
      >
        {props.traits ? <EffortLevels traits={props.traits} /> : <NoEffortRow />}
      </div>
    </div>
  );
}
