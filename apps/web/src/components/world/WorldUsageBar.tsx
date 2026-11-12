import {
  collectLimitAccounts,
  collectLimitPools,
  cursorUsageWindowDetails,
  displayLimitWindows,
  formatDuration,
  type LimitAccount,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import type { UsageProviderKind } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronDownIcon } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState, type ComponentProps } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useNowMinute } from "../../hooks/useNowMinute";
import { observeResize } from "../../lib/observeResize";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Popover, PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
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
  /** Set when the pool has several accounts: the one whose windows are shown instead of the pooled mean. */
  readonly account: LimitAccount | null;
}

const NO_SELECTED_ACCOUNTS: Readonly<Record<string, string>> = {};
const SelectedAccounts = Schema.Record(Schema.String, Schema.String);

function accountName(account: LimitAccount, driverLabel: string) {
  return account.displayName?.trim() || account.sourceLabel || driverLabel;
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

/** Opens the usage popover when the pill is live; the measuring copies only take up room. */
function PillTrigger({
  handle,
  className,
  children,
}: {
  readonly handle: ReturnType<typeof PopoverCreateHandle> | undefined;
  readonly className: string;
  readonly children: React.ReactNode;
}) {
  return handle ? (
    <PopoverTrigger
      handle={handle}
      aria-label="Subscription usage"
      render={<button type="button" className={cn("cursor-pointer", className)} />}
    >
      {children}
    </PopoverTrigger>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** Names the account behind a pool's meters and, when live, switches between its accounts. */
function AccountSwitcher({
  pool,
  account,
  level,
  onSelect,
}: {
  readonly pool: LimitPool;
  readonly account: LimitAccount;
  readonly level: Level;
  readonly onSelect: ((driver: string, accountKey: string) => void) | undefined;
}) {
  const driverLabel = providerClients.get(pool.driver)?.label ?? String(pool.driver);
  const face = (
    <>
      <ProviderInstanceIcon
        driverKind={pool.driver}
        displayName={driverLabel}
        className="size-4"
        iconClassName="size-3.5 text-foreground/80"
      />
      {level < 2 ? (
        <span className="max-w-28 truncate text-muted-foreground">
          {accountName(account, driverLabel)}
        </span>
      ) : null}
      <ChevronDownIcon aria-hidden className="size-3 text-muted-foreground" />
    </>
  );
  if (!onSelect) return <span className="flex items-center gap-1.5 pl-2">{face}</span>;
  return (
    <Menu>
      <MenuTrigger
        aria-label={`${driverLabel} account`}
        render={
          <button
            type="button"
            className="flex h-full cursor-pointer items-center gap-1.5 rounded-full pl-2"
          />
        }
      >
        {face}
      </MenuTrigger>
      <MenuPopup align="start" sideOffset={8}>
        <MenuRadioGroup
          value={account.key}
          onValueChange={(value) => onSelect(pool.driver, String(value))}
        >
          {pool.accounts.map((candidate) => (
            <MenuRadioItem key={candidate.key} value={candidate.key}>
              {accountName(candidate, driverLabel)}
              {candidate.plan ? (
                <span className="ml-2 text-muted-foreground">{candidate.plan}</span>
              ) : null}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * The pill at one level. The live one (it has a `handle`) opens the popover from its
 * meters and switches accounts from its labels; the rest are only measured.
 */
function UsagePill({
  pools,
  shows,
  now,
  level,
  handle,
  onSelectAccount,
  className,
  ...props
}: ComponentProps<"div"> & {
  readonly pools: readonly PoolWindows[];
  readonly shows: MeterShows;
  readonly now: number;
  readonly level: Level;
  readonly handle?: ReturnType<typeof PopoverCreateHandle> | undefined;
  readonly onSelectAccount?: ((driver: string, accountKey: string) => void) | undefined;
}) {
  return (
    <div
      {...props}
      className={cn(
        "surface-glass flex h-9 w-max shrink-0 sm:h-8 items-center rounded-full",
        "border border-border/60 px-1 text-xs text-foreground shadow-sm",
        className,
      )}
    >
      {pools.map(({ pool, windows, account }) => {
        const label = providerClients.get(pool.driver)?.label ?? String(pool.driver);
        const color = barColor(pool.driver);
        const meters =
          level === 4 ? (
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
          );
        if (account) {
          return (
            <span key={pool.driver} className="flex h-full items-center">
              <AccountSwitcher
                pool={pool}
                account={account}
                level={level}
                onSelect={handle ? onSelectAccount : undefined}
              />
              <PillTrigger
                handle={handle}
                className="flex h-full items-center gap-2.5 rounded-full pr-2 pl-2.5"
              >
                {meters}
              </PillTrigger>
            </span>
          );
        }
        return (
          <PillTrigger
            key={pool.driver}
            handle={handle}
            className="flex h-full items-center gap-2.5 rounded-full px-2"
          >
            <ProviderInstanceIcon
              driverKind={pool.driver}
              displayName={label}
              className="size-4"
              iconClassName="size-3.5 text-foreground/80"
            />
            {meters}
          </PillTrigger>
        );
      })}
    </div>
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
  const [selectedAccounts, setSelectedAccounts] = useLocalStorage(
    "floripacode:world-usage-account:v1",
    NO_SELECTED_ACCOUNTS,
    SelectedAccounts,
  );
  const presentations = useLimitPresentations(null, hiddenProviders);
  // Countdowns move a minute at a time, so the bar repaints at most once a minute.
  const now = Date.parse(`${useNowMinute()}:00Z`);
  // Windows with nothing used yet say nothing worth the room; a provider with none used drops out.
  // A pool of several accounts shows the chosen account's own windows rather than their mean.
  const pools = collectLimitPools(collectLimitAccounts(presentations), now).flatMap(
    (pool): PoolWindows[] => {
      const windows = displayLimitWindows(pool).filter((window) => window.usedPercent > 0);
      if (windows.length === 0) return [];
      if (pool.accounts.length < 2) return [{ pool, windows, account: null }];
      const account =
        pool.accounts.find((candidate) => candidate.key === selectedAccounts[pool.driver]) ??
        pool.accounts[0]!;
      const own = displayLimitWindows(collectLimitPools([account], now)[0]!);
      const used = own.filter((window) => window.usedPercent > 0);
      return [{ pool, windows: used.length > 0 ? used : own, account }];
    },
  );

  if (pools.length === 0) return null;
  return (
    <FittedUsagePill
      pools={pools}
      shows={shows}
      onShowsChange={setShows}
      onSelectAccount={(driver, accountKey) =>
        setSelectedAccounts({ ...selectedAccounts, [driver]: accountKey })
      }
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
  onSelectAccount,
  now,
  hiddenProviders,
}: {
  readonly pools: readonly PoolWindows[];
  readonly shows: MeterShows;
  readonly onShowsChange: (shows: MeterShows) => void;
  readonly onSelectAccount: (driver: string, accountKey: string) => void;
  readonly now: number;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const [handle] = useState(PopoverCreateHandle);
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
          <UsagePill key={variant} pools={pools} shows={shows} now={now} level={variant} />
        ))}
      </div>
      <Popover handle={handle}>
        <UsagePill
          ref={pillRef}
          className="pointer-events-auto"
          pools={pools}
          shows={shows}
          now={now}
          level={level}
          handle={handle}
          onSelectAccount={onSelectAccount}
        />
        <PopoverPopup side="bottom" align="end" sideOffset={8} anchor={pillRef}>
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
