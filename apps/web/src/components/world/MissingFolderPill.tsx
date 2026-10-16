import { useAtomValue } from "@effect/atom-react";
import { scopedProjectKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import { TriangleAlertIcon, Trash2Icon } from "lucide-react";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { useEffect, useMemo, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { releaseProjectDraftUploads } from "../../lib/composerDraftUploads";
import { readLocalApi } from "../../localApi";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useThreadShellsForProjectRefs } from "../../state/entities";
import { filesystemEnvironment } from "../../state/filesystem";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { readEnvironmentScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Separator } from "../ui/separator";

/** How long Remove waits for its confirming second click. */
const CONFIRM_MS = 4_000;

const missingRootsAtom = (environmentId: EnvironmentId) =>
  projectEnvironment.missingRoots({ environmentId, input: {} });

/** Scoped keys of the projects whose folder is gone, across these environments. */
const missingProjectKeysAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const environmentIds = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
    return new Set(
      environmentIds.flatMap((environmentId) =>
        (
          Option.getOrNull(AsyncResult.value(get(missingRootsAtom(environmentId))))?.projectIds ??
          []
        ).map((projectId) => scopedProjectKey({ environmentId, projectId })),
      ),
    );
  }),
);

/** The projects, of those given, whose folder no longer exists. Checked again every minute. */
export function useMissingProjects(
  projects: ReadonlyArray<EnvironmentProject>,
): ReadonlyArray<EnvironmentProject> {
  const environmentKey = JSON.stringify(
    [...new Set(projects.map((project) => project.environmentId))].toSorted(),
  );
  const missing = useAtomValue(missingProjectKeysAtom(environmentKey));
  return useMemo(
    () =>
      projects.filter((project) =>
        missing.has(
          scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
        ),
      ),
    [projects, missing],
  );
}

/**
 * The alert over an island whose project folder is gone, moved or deleted
 * outside the app. It opens a popover that points the project at the folder's
 * new place, or removes the project and its threads.
 */
export function MissingFolderPill(props: {
  /** The island's projects whose folder is gone; usually one. */
  readonly projects: ReadonlyArray<EnvironmentProject>;
}) {
  const { projects } = props;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-1 rounded-full bg-warning px-2.5 py-1 text-xs font-medium text-warning-foreground shadow-md ring-2 ring-background transition-transform hover:scale-105"
          />
        }
      >
        <TriangleAlertIcon className="size-3.5" />
        Folder not found
      </PopoverTrigger>
      {/* Padded like the world's other bubbles (BubbleComposer), not the app's roomier popovers. */}
      <PopoverPopup side="top" width="md" padding="none">
        <div className="flex flex-col gap-4 p-2.5">
          {projects.map((project) => (
            <MissingFolderForm key={`${project.environmentId}:${project.id}`} project={project} />
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function MissingFolderForm({ project }: { readonly project: EnvironmentProject }) {
  const { environmentId } = project;
  const projectRef = useMemo(
    () => ({ environmentId, projectId: project.id }),
    [environmentId, project.id],
  );
  const threads = useThreadShellsForProjectRefs(useMemo(() => [projectRef], [projectRef]));
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const updateProject = useAtomCommand(projectEnvironment.update, { reportFailure: false });
  const deleteProject = useAtomCommand(projectEnvironment.delete, { reportFailure: false });
  const [path, setPath] = useState(project.workspaceRoot);
  const [step, setStep] = useState<"idle" | "moving" | "confirm-remove" | "removing">("idle");
  const [error, setError] = useState<string | null>(null);
  const allowed = readEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  // The typed path is checked on the project's server, which may not be this machine.
  const [checkedPath, pathCheck] = useDebouncedValue(
    path.trim(),
    { wait: 300 },
    (debouncerState) => ({ isPending: debouncerState.isPending }),
  );
  const changed = checkedPath !== "" && checkedPath !== project.workspaceRoot;
  // Listing the folder's own contents succeeds only when it exists and is a folder.
  const folder = useEnvironmentQuery(
    changed
      ? filesystemEnvironment.browse({
          environmentId,
          input: { partialPath: /[\\/]$/.test(checkedPath) ? checkedPath : `${checkedPath}/` },
        })
      : null,
  );
  const checking = pathCheck.state.isPending || folder.isPending || checkedPath !== path.trim();
  const pathIsFolder = changed && !checking && folder.isSuccess;
  const pathIsMissing = changed && !checking && folder.failure !== null;
  // The system folder picker only knows this machine's folders.
  const canBrowse =
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined &&
    environmentId === primaryEnvironmentId;

  useEffect(() => {
    if (step !== "confirm-remove") return;
    const timer = window.setTimeout(() => setStep("idle"), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [step]);

  const failureMessage = (result: Parameters<typeof squashAtomCommandFailure>[0]) => {
    const failure = squashAtomCommandFailure(result);
    return failure instanceof Error ? failure.message : "Something went wrong.";
  };

  const move = async (workspaceRoot: string) => {
    const next = workspaceRoot.trim();
    if (next === "" || step === "moving") return;
    setStep("moving");
    setError(null);
    const result = await updateProject({
      environmentId,
      input: { projectId: project.id, workspaceRoot: next },
    });
    setStep("idle");
    if (result._tag === "Success") {
      // Clears this alert now rather than at the next minute's check.
      appAtomRegistry.refresh(missingRootsAtom(environmentId));
    } else if (!isAtomCommandInterrupted(result)) {
      setError(failureMessage(result));
    }
  };

  const browse = async () => {
    const picked = await readLocalApi()
      ?.dialogs.pickFolder()
      .catch(() => null);
    if (!picked) return;
    setPath(picked);
    await move(picked);
  };

  const remove = async () => {
    setStep("removing");
    setError(null);
    const result = await deleteProject({
      environmentId,
      input: { projectId: project.id, force: true },
    });
    if (result._tag === "Success") {
      const draftStore = useComposerDraftStore.getState();
      releaseProjectDraftUploads(
        projectRef,
        threads.map((thread) => ({ environmentId, threadId: thread.id })),
      );
      const draft = draftStore.getDraftThreadByProjectRef(projectRef);
      if (draft) draftStore.clearDraftThread(draft.draftId);
      draftStore.clearProjectDraftThreadId(projectRef);
      return;
    }
    setStep("idle");
    if (!isAtomCommandInterrupted(result)) setError(failureMessage(result));
  };

  const busy = step === "moving" || step === "removing";
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (pathIsFolder) void move(path);
      }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{project.title}'s folder is gone</span>
        <span className="text-xs break-all text-muted-foreground">
          {project.workspaceRoot} no longer exists. Point the project at its new place, or remove
          it.
        </span>
      </div>
      {error !== null ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : pathIsMissing ? (
        <p className="text-xs text-destructive">There's no folder at this path.</p>
      ) : null}
      <div className="flex gap-1.5">
        <Input
          size="sm"
          aria-label="New folder"
          value={path}
          disabled={!allowed || busy}
          onChange={(event) => setPath(event.target.value)}
        />
        {canBrowse ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!allowed || busy}
            onClick={() => void browse()}
          >
            Browse…
          </Button>
        ) : null}
      </div>
      {/* Edge to edge: bleeds through the bubble's side padding. */}
      <Separator className="-mx-2.5 my-0.5 data-[orientation=horizontal]:w-auto" />
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant={step === "confirm-remove" ? "destructive" : "destructive-soft"}
          size="xs"
          disabled={!allowed || busy}
          onClick={() => {
            if (step === "confirm-remove") void remove();
            else setStep("confirm-remove");
          }}
        >
          <Trash2Icon />
          {step === "removing"
            ? "Removing…"
            : step === "confirm-remove"
              ? threads.length > 0
                ? `Remove with ${threads.length} thread${threads.length === 1 ? "" : "s"}`
                : "Confirm"
              : "Remove project"}
        </Button>
        <Button type="submit" size="xs" disabled={!allowed || busy || !pathIsFolder}>
          {step === "moving" ? "Moving…" : "Use this folder"}
        </Button>
      </div>
    </form>
  );
}
