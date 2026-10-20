import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatDuration,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";
import { Settings2Icon } from "lucide-react";
import { Fragment, useState } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { barColor, UsageLimitsSection, useLimitPresentations } from "../usage/UsageLimits";
import { readUsagePagePreferences } from "../usage/usagePagePreferences";

const MeterShows = Schema.Literals(["left", "used"]);
type MeterShows = typeof MeterShows.Type;

/** One window: what is left or used, a bar, and when the next reset hands anything back. */
function WindowMeter({
  window,
  label,
  color,
  shows,
  now,
}: {
  readonly window: LimitPoolWindow;
  readonly label: string;
  readonly color: string;
  readonly shows: MeterShows;
  readonly now: number;
}) {
  const nextRefill = window.resets.find((reset) => reset.restoresPercent > 0 && reset.at > now);
  const percent = shows === "used" ? window.usedPercent : window.remainingPercent;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2.5 w-12 overflow-hidden rounded-full bg-foreground/15">
        <span
          className="block h-full rounded-full"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </span>
      <span className="font-medium text-foreground tabular-nums">{percent}%</span>
      {nextRefill ? (
        <span className="text-muted-foreground tabular-nums">
          ↻ {formatDuration(nextRefill.at - now)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Subscription quota pooled per provider, along the bottom of the world. It
 * reads the same snapshots as Usage → Limits and never refreshes them itself;
 * click it for the full breakdown. Providers hidden on the Usage page stay
 * hidden here, and so are windows nothing has used yet. Its gear picks whether the meters show quota left or used.
 */
export function WorldUsageBar() {
  const [hiddenProviders] = useState(
    () => new Set(readUsagePagePreferences().hiddenProviders ?? []),
  );
  const [shows, setShows] = useLocalStorage("t3code:world-usage-shows:v1", "left", MeterShows);
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
    <div className="surface-glass flex h-8 max-w-full items-center gap-1 overflow-hidden rounded-full border border-border/60 pr-1 text-xs text-foreground shadow-sm">
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Subscription usage"
              className="flex h-full min-w-0 cursor-pointer items-center gap-4 overflow-hidden pl-3"
            />
          }
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
                {windows.map((window, index) => (
                  <Fragment key={`${window.kind}:${window.id}`}>
                    {index > 0 ? (
                      <span aria-hidden className="h-3.5 w-px shrink-0 bg-foreground/20" />
                    ) : null}
                    <WindowMeter
                      window={window}
                      label={
                        (pool.driver === "cursor"
                          ? cursorUsageWindowDetails(window.id)?.label
                          : null) ?? window.label
                      }
                      color={color}
                      shows={shows}
                      now={now}
                    />
                  </Fragment>
                ))}
              </span>
            );
          })}
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" sideOffset={8}>
          <div className="w-[min(40rem,calc(100vw-3rem))]">
            <UsageLimitsSection
              selectedEnvironmentIds={null}
              hiddenProviders={hiddenProviders}
              now={now}
            />
          </div>
        </PopoverPopup>
      </Popover>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label="Usage bar settings"
            />
          }
        >
          <Settings2Icon className="size-4" />
        </PopoverTrigger>
        <PopoverPopup side="top" align="end" sideOffset={8}>
          <ToggleGroup
            aria-label="Meters show"
            value={[shows]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "left" || value === "used") setShows(value);
            }}
          >
            <Toggle value="left">Left</Toggle>
            <Toggle value="used">Used</Toggle>
          </ToggleGroup>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
