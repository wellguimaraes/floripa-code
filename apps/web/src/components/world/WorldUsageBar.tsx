import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatDuration,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import type { UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Fragment, useLayoutEffect, useRef, useState, type ComponentProps } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { barColor, UsageLimitsSection, useLimitPresentations } from "../usage/UsageLimits";
import { readUsagePagePreferences } from "../usage/usagePagePreferences";

const MeterShows = Schema.Literals(["left", "used"]);
type MeterShows = typeof MeterShows.Type;

/**
 * How much the pill gives up to fit, in order: 0 shows everything, 1 drops the
 * reset countdown, 2 the percentage, 3 shortens labels to initials, and 4 keeps
 * only each provider's icon over a stack of thin bars.
 */
const LEVELS = [0, 1, 2, 3, 4] as const;
type Level = (typeof LEVELS)[number];

interface PoolWindows {
  readonly pool: LimitPool;
  readonly windows: readonly LimitPoolWindow[];
}

/** "Weekly · Fable" reads "W·F", so shortened labels stay apart. */
function initials(label: string) {
  return label
    .split("·")
    .map((part) => part.trim().charAt(0).toUpperCase())
    .join("·");
}

function windowLabel(pool: LimitPool, window: LimitPoolWindow) {
  return (
    (pool.driver === "cursor" ? cursorUsageWindowDetails(window.id)?.label : null) ?? window.label
  );
}

/** One window: its label, a bar, what is left or used, and when the next reset hands anything back. */
function WindowMeter({
  window,
  label,
  color,
  shows,
  now,
  level,
}: {
  readonly window: LimitPoolWindow;
  readonly label: string;
  readonly color: string;
  readonly shows: MeterShows;
  readonly now: number;
  readonly level: Level;
}) {
  const nextRefill = window.resets.find((reset) => reset.restoresPercent > 0 && reset.at > now);
  const percent = shows === "used" ? window.usedPercent : window.remainingPercent;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{level >= 3 ? initials(label) : label}</span>
      <span className="h-2.5 w-12 overflow-hidden rounded-full bg-foreground/15">
        <span
          className="block h-full rounded-full"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </span>
      {level < 2 ? (
        <span className="font-medium text-foreground tabular-nums">{percent}%</span>
      ) : null}
      {level < 1 && nextRefill ? (
        <span className="text-muted-foreground tabular-nums">
          ↻ {formatDuration(nextRefill.at - now)}
        </span>
      ) : null}
    </span>
  );
}

/** The pill at one level; the live one is the popover trigger, the rest are only measured. */
function UsagePill({
  pools,
  shows,
  now,
  level,
  className,
  ...props
}: ComponentProps<"button"> & {
  readonly pools: readonly PoolWindows[];
  readonly shows: MeterShows;
  readonly now: number;
  readonly level: Level;
}) {
  return (
    <button
      type="button"
      aria-label="Subscription usage"
      {...props}
      className={cn(
        "surface-glass flex h-8 w-max shrink-0 sm:h-7 cursor-pointer items-center gap-4 rounded-full",
        "border border-border/60 px-3 text-xs text-foreground shadow-sm",
        className,
      )}
    >
      {pools.map(({ pool, windows }) => {
        const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
        const color = barColor(pool.driver);
        return (
          <span key={pool.driver} className="flex items-center gap-2.5">
            <ProviderInstanceIcon
              driverKind={pool.driver}
              displayName={label}
              className="size-4"
              iconClassName="size-3.5 text-foreground/80"
            />
            {level === 4 ? (
              <span className="flex w-10 flex-col gap-0.5">
                {windows.map((window) => (
                  <span
                    key={`${window.kind}:${window.id}`}
                    className="h-1 overflow-hidden rounded-full bg-foreground/15"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${shows === "used" ? window.usedPercent : window.remainingPercent}%`,
                        backgroundColor: color,
                      }}
                    />
                  </span>
                ))}
              </span>
            ) : (
              windows.map((window, index) => (
                <Fragment key={`${window.kind}:${window.id}`}>
                  {index > 0 ? (
                    <span aria-hidden className="h-3.5 w-px shrink-0 bg-foreground/20" />
                  ) : null}
                  <WindowMeter
                    window={window}
                    label={windowLabel(pool, window)}
                    color={color}
                    shows={shows}
                    now={now}
                    level={level}
                  />
                </Fragment>
              ))
            )}
          </span>
        );
      })}
    </button>
  );
}

/**
 * Subscription quota pooled per provider, at the right of the world's top bar.
 * It reads the same snapshots as Usage → Limits and never refreshes them itself;
 * click it for the full breakdown and to pick whether the meters show quota left
 * or used. Providers hidden on the Usage page stay hidden here, and so are
 * windows nothing has used yet. It takes the room the bar has left and sheds
 * detail to fit.
 */
export function WorldUsageBar() {
  const [hiddenProviders] = useState(
    () => new Set(readUsagePagePreferences().hiddenProviders ?? []),
  );
  const [shows, setShows] = useLocalStorage("floripacode:world-usage-shows:v1", "left", MeterShows);
  const presentations = useLimitPresentations(null, hiddenProviders);
  // Countdowns move a minute at a time, so the bar repaints at most once a minute.
  const now = Date.parse(`${useNowMinute()}:00Z`);
  // Windows with nothing used yet say nothing worth the room; a provider with none used drops out.
  const pools = collectLimitPools(collectLimitAccounts(presentations), now).flatMap((pool) => {
    const windows = displayLimitWindows(pool).filter((window) => window.usedPercent > 0);
    return windows.length > 0 ? [{ pool, windows }] : [];
  });

  if (pools.length === 0) return null;
  return (
    <FittedUsagePill
      pools={pools}
      shows={shows}
      onShowsChange={setShows}
      now={now}
      hiddenProviders={hiddenProviders}
    />
  );
}

/** Takes the room the top bar has left and shows the most detailed level that fits it. */
function FittedUsagePill({
  pools,
  shows,
  onShowsChange,
  now,
  hiddenProviders,
}: {
  readonly pools: readonly PoolWindows[];
  readonly shows: MeterShows;
  readonly onShowsChange: (shows: MeterShows) => void;
  readonly now: number;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [level, setLevel] = useState<Level>(0);
  // Every level renders once, hidden, so the widest that fits the slot is known without
  // trial renders. Their widths change only with content, so watching them and the slot
  // covers both window resizes and new usage.
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const measure = measureRef.current;
    if (!slot || !measure) return;
    const variants = [...measure.children];
    const fit = () => {
      const available = slot.clientWidth;
      const index = variants.findIndex(
        (variant) => variant.getBoundingClientRect().width <= available,
      );
      setLevel(LEVELS[index === -1 ? LEVELS.length - 1 : index]!);
    };
    return observeResize([slot, ...variants], fit);
  }, []);

  return (
    <div ref={slotRef} className="relative flex min-w-0 flex-1 justify-end">
      <div
        ref={measureRef}
        aria-hidden
        inert
        className="pointer-events-none invisible absolute top-0 right-0 h-0 w-0 overflow-hidden"
      >
        {LEVELS.map((variant) => (
          <UsagePill
            key={variant}
            pools={pools}
            shows={shows}
            now={now}
            level={variant}
            tabIndex={-1}
          />
        ))}
      </div>
      <Popover>
        <PopoverTrigger
          render={
            <UsagePill
              className="pointer-events-auto"
              pools={pools}
              shows={shows}
              now={now}
              level={level}
            />
          }
        />
        <PopoverPopup side="bottom" align="end" sideOffset={8}>
          <div className="flex w-max max-w-[min(28rem,calc(100vw-3rem))] flex-col gap-3">
            {/* Bleeds past the popover's inline padding so its divider spans edge to edge. */}
            <div className="-mx-(--viewport-inline-padding) flex items-center justify-between gap-3 border-b px-(--viewport-inline-padding) pb-4 text-sm">
              <span className="text-base font-semibold text-foreground">Usage stats</span>
              <ToggleGroup
                aria-label="Usage stats"
                value={[shows]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "left" || value === "used") onShowsChange(value);
                }}
              >
                <Toggle value="left">Left</Toggle>
                <Toggle value="used">Used</Toggle>
              </ToggleGroup>
            </div>
            <UsageLimitsSection
              selectedEnvironmentIds={null}
              hiddenProviders={hiddenProviders}
              now={now}
              shows={shows}
            />
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
