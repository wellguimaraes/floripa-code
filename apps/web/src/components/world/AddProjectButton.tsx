import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { readLocalApi } from "../../localApi";
import { findProjectByPath, inferProjectTitleFromPath } from "../../lib/projectPaths";
import { getLocalFileManagerName, newProjectId } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { useWorldVisibilityStore } from "./worldVisibilityStore";

/**
 * Adds a project to the world. It opens the system folder picker and makes a project of the
 * chosen folder, which then shows up as a new island. Only the desktop app has a folder
 * picker, so `available` is false in the browser. Picking a project that is already there
 * brings its island back if it was hidden.
 */
export function useAddProject(
  /** The island each project stands on, by scoped project key. */
  islandOf: ReadonlyMap<string, string>,
) {
  const environmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const [picking, setPicking] = useState(false);
  const available =
    typeof window !== "undefined" && window.desktopBridge !== undefined && environmentId !== null;

  const addProject = async () => {
    const api = readLocalApi();
    if (!api || environmentId === null) return;
    setPicking(true);
    let cwd: string | null;
    try {
      cwd = await api.dialogs.pickFolder();
    } catch {
      return;
    } finally {
      setPicking(false);
    }
    if (!cwd) return;

    const existing = findProjectByPath(
      projects.filter((project) => project.environmentId === environmentId),
      cwd,
    );
    if (existing) {
      const island = islandOf.get(
        scopedProjectKey(scopeProjectRef(existing.environmentId, existing.id)),
      );
      const visibility = useWorldVisibilityStore.getState();
      if (island !== undefined && visibility.hidden[island]) visibility.toggleHidden(island);
      return;
    }
    if (!readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) {
      toastManager.add({
        type: "error",
        title: "Cannot add project",
        description: "This connection cannot add projects.",
      });
      return;
    }
    const result = await createProject({
      environmentId,
      input: {
        projectId: newProjectId(),
        title: inferProjectTitleFromPath(cwd),
        workspaceRoot: cwd,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: null,
      },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Failed to add project",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };

  return { available, picking, addProject };
}

/** Top bar button that adds a project to the world; see `useAddProject`. */
export function AddProjectButton(props: {
  /** The island each project stands on, by scoped project key. */
  readonly islandOf: ReadonlyMap<string, string>;
}) {
  const { available, picking, addProject } = useAddProject(props.islandOf);
  if (!available) return null;

  return (
    <Button
      variant="glass"
      size="icon-sm"
      aria-label="Add project"
      title={`Add a project from ${getLocalFileManagerName(navigator.platform)}`}
      disabled={picking}
      onClick={() => void addProject()}
    >
      <PlusIcon />
    </Button>
  );
}
