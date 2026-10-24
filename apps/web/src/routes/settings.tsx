import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { RotateCcwIcon, XIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Dialog, DialogClose, DialogPopup } from "../components/ui/dialog";
import { SettingsSidebarNav } from "../components/settings/SettingsSidebarNav";
import { useWorldModeStore } from "../components/world/worldModeStore";
import { useSettingsRestore } from "../components/settings/SettingsPanels";

import { SettingsBreadcrumb } from "../components/settings/SettingsBreadcrumb";
import { SidebarInset } from "../components/ui/sidebar";
import { useNavigateToMainApp } from "../components/sidebar/mainAppLocation";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { isElectron } from "../env";
import { useEscapeToGoBack } from "../hooks/useNavigateBack";
import {
  SettingsScopeProvider,
  useSettingsScope,
} from "../components/settings/SettingsScopeContext";
import { useEnvironments } from "../state/environments";
import { SettingsScopeNotice } from "../components/settings/SettingsScopeNotice";
import { SETTINGS_DEVICE_ONLY_PATHS } from "../components/settings/SettingsScopeSentence";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "../components/settings/settingsScopeNavigation";
import {
  getSettingsSearchTargetScope,
  getThreadAutoSettlementSearchAvailability,
  isSettingsSearchScopeAvailable,
} from "../components/settings/settingsSearch";

function RestoreDeviceDefaultsButton({ onRestored }: { onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={changedSettingLabels.length === 0}
      onClick={() => void restoreDefaults()}
    >
      <RotateCcwIcon className="mx-1 size-3.5" />
      Restore device defaults
    </Button>
  );
}

function SettingsScopeBoundary({ pathname, children }: { pathname: string; children: ReactNode }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  const { environments } = useEnvironments();
  const hash = useLocation({ select: (location) => location.hash });
  const searchTarget = getSettingsSearchTargetScope(hash);
  const autoSettlementAvailability = searchTarget?.requiresThreadAutoSettlement
    ? getThreadAutoSettlementSearchAvailability(environments, scope)
    : null;
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    autoSettlementAvailability &&
    !autoSettlementAvailability.isTargetAvailable
  ) {
    return (
      <SettingsScopeNotice
        target="environment"
        targetId={hash}
        eligibleEnvironmentIds={autoSettlementAvailability.eligibleEnvironmentIds}
      >
        {autoSettlementAvailability.eligibleEnvironmentIds.length > 0
          ? `${searchTarget.title} requires a supporting environment. Choose one to continue.`
          : `${searchTarget.title} requires a supporting environment. Connect or update an environment to continue.`}
      </SettingsScopeNotice>
    );
  }
  if (
    scope.kind !== "unavailable" &&
    searchTarget &&
    !isSettingsSearchScopeAvailable(searchTarget.scope, scope.kind)
  ) {
    const target =
      searchTarget.scope === "environment" ||
      searchTarget.scope === "project" ||
      searchTarget.scope === "checkout"
        ? searchTarget.scope
        : "all";
    return (
      <SettingsScopeNotice target={target} targetId={hash}>
        {`${searchTarget.title} is not available for the selected target. Choose its owning scope to continue.`}
      </SettingsScopeNotice>
    );
  }
  // Device-local pages ignore the scope entirely; the project page follows
  // remembered members while a grouping change replaces its URL key.
  if (SETTINGS_DEVICE_ONLY_PATHS.has(pathname) || pathname === "/settings/projects") {
    return children;
  }
  // Keep the scope sentence on screen so the selection can be changed back.
  if (scope.kind === "unavailable")
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">{scope.message}</p>
      </SettingsPageContainer>
    );
  if (scope.kind === "environment" && connectedEnvironments.length === 0) {
    return (
      <SettingsPageContainer>
        <p className="text-sm text-muted-foreground">
          Reconnect {scope.label} to change its settings.
        </p>
      </SettingsPageContainer>
    );
  }
  return children;
}

function SettingsContentLayout() {
  const location = useLocation();
  const navigateToMainApp = useNavigateToMainApp();
  // Opened from the world, which stays mounted behind it, Settings is a dialog over the map.
  const overWorld = useWorldModeStore((state) => state.shown);
  const { search, environment } = useSettingsScope();
  const contentScopeKey =
    location.pathname === "/settings/diagnostics" || location.pathname === "/settings/providers"
      ? environment?.environmentId
      : JSON.stringify(search);
  const [restoreSignal, setRestoreSignal] = useState(0);

  const heading = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <SettingsBreadcrumb pathname={location.pathname} />
      {location.pathname === "/settings/general" ? (
        <div className="ms-auto flex shrink-0 items-center">
          <RestoreDeviceDefaultsButton onRestored={() => setRestoreSignal((value) => value + 1)} />
        </div>
      ) : null}
    </div>
  );
  const content = (
    <div key={`${contentScopeKey}:${restoreSignal}`} className="min-h-0 flex flex-1 flex-col">
      <SettingsScopeBoundary pathname={location.pathname}>
        <Outlet />
      </SettingsScopeBoundary>
    </div>
  );
  if (overWorld) {
    return (
      <SettingsDialog pathname={location.pathname} heading={heading} onClose={navigateToMainApp}>
        {content}
      </SettingsDialog>
    );
  }
  return (
    <SettingsPage heading={heading} onClose={navigateToMainApp}>
      {content}
    </SettingsPage>
  );
}

function SettingsPage({
  heading,
  onClose,
  children,
}: {
  heading: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscapeToGoBack(onClose);
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>{heading}</WorkspacePageHeader>
        {children}
      </div>
    </SidebarInset>
  );
}

/**
 * Settings nearly filling the window, its own nav on the left since the world folds the
 * sidebar away. Escape, the close button or a click outside it go back to the world.
 */
function SettingsDialog({
  pathname,
  heading,
  onClose,
  children,
}: {
  pathname: string;
  heading: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  // The close-window chord closes the dialog instead of the app's window.
  const closeOnCloseChord = useEffectEvent((event: KeyboardEvent) => {
    const mod = isMacPlatform(navigator.platform)
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    if (!mod || event.altKey || event.shiftKey || event.key.toLowerCase() !== "w") return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) onClose();
  });
  useEffect(() => {
    window.addEventListener("keydown", closeOnCloseChord, true);
    return () => window.removeEventListener("keydown", closeOnCloseChord, true);
  }, []);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) void onClose();
      }}
    >
      <DialogPopup
        aria-label="Settings"
        showCloseButton={false}
        bottomStickOnMobile={false}
        // A title bar's height clear on every side, so it starts below the window controls.
        className="h-[calc(100dvh-2*var(--workspace-topbar-height))] w-[calc(100vw-2*var(--workspace-topbar-height))] max-w-none flex-row overflow-hidden"
      >
        {/* Rows tint with the text colour rather than the sidebar's white, which barely shows here. */}
        <nav
          aria-label="Settings"
          className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground [--sidebar-row-hover:color-mix(in_srgb,var(--foreground)_5%,transparent)] [--sidebar-row-selected:color-mix(in_srgb,var(--foreground)_9%,transparent)]"
        >
          <SettingsSidebarNav pathname={pathname} />
        </nav>
        <div className="flex min-w-0 flex-1 flex-col bg-background text-foreground">
          <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
            {heading}
            <DialogClose
              render={<Button variant="ghost" size="icon-sm" aria-label="Close settings" />}
            >
              <XIcon />
            </DialogClose>
          </header>
          {children}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function SettingsRouteLayout() {
  const rawSearch = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <SettingsScopeProvider
      search={rawSearch}
      singleEnvironment={pathname === "/settings/providers"}
      onChange={(next) => {
        // Send every axis so the retain middleware sees an explicit target
        // even when the choice is "all", which is the absence of a key.
        void navigate({
          to: pathname,
          search: () => ({
            project: next.project,
            machine: next.machine,
            checkout: next.checkout,
          }),
          hash: "",
          resetScroll: false,
        });
      }}
    >
      <SettingsContentLayout />
    </SettingsScopeProvider>
  );
}

export const Route = createFileRoute("/settings")({
  validateSearch: validateSettingsRouteSearch,
  search: { middlewares: [retainSettingsScope] },
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }

    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsRouteLayout,
});
