import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  projectFaviconRefreshAtom,
  projectFaviconRefreshKey,
} from "@t3tools/client-runtime/state/assets";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type ProjectIconOverride } from "@t3tools/contracts";
import { lazy, Suspense, useContext } from "react";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { readEnvironmentScope } from "../../state/session";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import {
  canPickExternalProjectFavicon,
  ProjectFaviconPickerDialog,
} from "../settings/ProjectFaviconPickerDialog";
import { toastManager } from "../ui/toast";

const ProjectIconPickerDialog = lazy(() =>
  import("../settings/ProjectIconPickerDialog").then((module) => ({
    default: module.ProjectIconPickerDialog,
  })),
);

type IslandIcon = {
  readonly faviconPath: string | null;
  readonly projectIcon: ProjectIconOverride | null;
};

/** Whether this connection may change the icon of every checkout on an island. */
export function canChangeIslandIcon(checkouts: ReadonlyArray<EnvironmentProject>): boolean {
  return (
    checkouts.length > 0 &&
    checkouts.every((checkout) =>
      readEnvironmentScope(checkout.environmentId, AuthOrchestrationOperateScope),
    )
  );
}

/**
 * Saves an island's icon on each of its checkouts, as Settings does for the
 * project group. Back to automatic (both null) also has each server look at
 * its files again, and asks it for the icon it finds.
 */
export function useSetIslandIcon() {
  const registry = useContext(RegistryContext);
  const updateProject = useOrchestrationCommand(projectEnvironment.update, {
    reportFailure: false,
  });
  return async (checkouts: ReadonlyArray<EnvironmentProject>, icon: IslandIcon) => {
    for (const checkout of checkouts) {
      const result = await updateProject({
        environmentId: checkout.environmentId,
        input: { projectId: checkout.id, ...icon },
      });
      if (result._tag === "Failure") {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not update the project icon",
          description: error instanceof Error ? error.message : undefined,
        });
        return;
      }
    }
    for (const checkout of checkouts) {
      registry.update(
        projectFaviconRefreshAtom(
          projectFaviconRefreshKey(checkout.environmentId, checkout.workspaceRoot),
        ),
        (count) => count + 1,
      );
    }
  };
}

/** Settings' icon pickers, opened from an island's sign. The first checkout is the island's main one. */
export function IslandIconPicker(props: {
  readonly checkouts: ReadonlyArray<EnvironmentProject>;
  readonly projectName: string;
  readonly picker: "icon" | "file";
  readonly onSelect: (icon: IslandIcon) => void;
  readonly onClose: () => void;
}) {
  const { checkouts, projectName, picker, onSelect, onClose } = props;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const main = checkouts[0]!;
  // A file from elsewhere on disk only resolves on this machine's checkouts.
  const pickExternal = checkouts.every(
    (checkout) =>
      checkout.environmentId === primaryEnvironmentId &&
      canPickExternalProjectFavicon(checkout.workspaceRoot, navigator.platform),
  )
    ? window.desktopBridge?.pickProjectFavicon
    : undefined;
  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };
  if (picker === "file") {
    return (
      <ProjectFaviconPickerDialog
        cwd={main.workspaceRoot}
        environmentId={main.environmentId}
        onOpenChange={onOpenChange}
        {...(pickExternal ? { onPickExternal: () => pickExternal(main.workspaceRoot) } : {})}
        onSelect={(path) => {
          onClose();
          onSelect({ faviconPath: path, projectIcon: null });
        }}
        open
        projectName={projectName}
      />
    );
  }
  return (
    <Suspense fallback={null}>
      <ProjectIconPickerDialog
        current={main.projectIcon ?? null}
        currentFaviconPath={main.faviconPath ?? null}
        environmentId={main.environmentId}
        cwd={main.workspaceRoot}
        projectName={main.title}
        open
        onOpenChange={onOpenChange}
        onSelect={(icon) => {
          onClose();
          onSelect(icon);
        }}
      />
    </Suspense>
  );
}
