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
import { useState } from "react";

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
/** Each meter is a row of pills, lit in proportion to its percentage. */
const SEGMENTS = 6;

/** One window: what is left or used, a segmented meter, and when the next reset hands anything back. */
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
  // Any quota at all lights one segment, so a sliver never reads as none.
  const filled = percent > 0 ? Math.max(1, Math.round((percent / 100) * SEGMENTS)) : 0;
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-0.5">
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <span
            key={index}
            className="h-3 w-1 rounded-full bg-foreground/15"
            style={index < filled ? { backgroundColor: color } : undefined}
          />
        ))}
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
 * hidden here. Its gear picks whether the meters show quota left or used.
 */
export function WorldUsageBar() {
  const [hiddenProviders] = useState(
    () => new Set(readUsagePagePreferences().hiddenProviders ?? []),
  );
  const [shows, setShows] = useLocalStorage("t3code:world-usage-shows:v1", "left", MeterShows);
  const presentations = useLimitPresentations(null, hiddenProviders);
  // Countdowns move a minute at a time, so the bar repaints at most once a minute.
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const pools = collectLimitPools(collectLimitAccounts(presentations), now).filter(
    (pool) => pool.windows.length > 0,
  );
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
          {pools.map((pool) => {
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
                {displayLimitWindows(pool).map((window) => (
                  <WindowMeter
                    key={`${window.kind}:${window.id}`}
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
          <Settings2Icon />
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
