import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  presentThreadShell,
  type EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  archivedThreadFamilies,
  archivedThreadLastActivityAt,
  isArchivedSubagent,
} from "@t3tools/client-runtime/state/threads";
import type { ArchivedThreadSortOrder, ScopedThreadRef } from "@t3tools/contracts";
import { ArchiveIcon, ArchiveX, CornerDownRightIcon } from "lucide-react";
import { useCallback, useMemo, type MouseEvent } from "react";

import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { readLocalApi } from "../../localApi";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const SORT_LABELS: Record<ArchivedThreadSortOrder, string> = {
  archived_at: "Date archived",
  last_activity: "Last activity",
};

function showFailure(title: string, result: Parameters<typeof squashAtomCommandFailure>[0]) {
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

export function ArchivedThreadsPanel() {
  const { scope } = useSettingsScope();
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const sortOrder = useClientSettings((settings) => settings.archivedThreadSortOrder);
  const updateClientSettings = useUpdateClientSettings();
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(scope.environmentIds);

  const archivedGroups = useMemo(() => {
    const selectedProjectKeys =
      scope.kind === "project" || scope.kind === "checkout"
        ? new Set(scope.members.map((member) => `${member.environmentId}:${member.id}`))
        : null;
    return archivedSnapshots.flatMap(({ environmentId, snapshot }) => {
      const threads = snapshot.threads.map((thread) => presentThreadShell(environmentId, thread));
      return snapshot.projects.flatMap((project) => {
        if (
          selectedProjectKeys !== null &&
          !selectedProjectKeys.has(`${environmentId}:${project.id}`)
        ) {
          return [];
        }
        const projectThreads = threads.filter((thread) => thread.projectId === project.id);
        if (projectThreads.length === 0) return [];
        return [
          {
            project: { ...project, environmentId },
            families: archivedThreadFamilies(projectThreads, sortOrder),
          },
        ];
      });
    });
  }, [archivedSnapshots, scope, sortOrder]);

  const unarchive = useCallback(
    async (threadRef: ScopedThreadRef) => {
      const result = await unarchiveThread(threadRef);
      if (result._tag === "Success") refreshArchivedThreads();
      else if (!isAtomCommandInterrupted(result)) showFailure("Failed to unarchive thread", result);
    },
    [refreshArchivedThreads, unarchiveThread],
  );

  const openRowMenu = useCallback(
    (thread: EnvironmentThreadShell, event: MouseEvent) => {
      event.preventDefault();
      const position = { x: event.clientX, y: event.clientY };
      const threadRef = scopeThreadRef(thread.environmentId, thread.id);
      void (async () => {
        const result = await settlePromise(async () => {
          const api = readLocalApi();
          if (!api) return;
          const clicked = await api.contextMenu.show(
            [
              { id: "unarchive", label: "Unarchive" },
              { id: "delete", label: "Delete", destructive: true },
            ],
            position,
          );
          if (clicked === "unarchive") return unarchive(threadRef);
          if (clicked !== "delete") return;
          const deleted = await confirmAndDeleteThread(threadRef);
          if (deleted._tag === "Success") refreshArchivedThreads();
          else if (!isAtomCommandInterrupted(deleted)) {
            showFailure("Failed to delete thread", deleted);
          }
        });
        if (result._tag === "Failure") showFailure("Archived thread action failed", result);
      })();
    },
    [confirmAndDeleteThread, refreshArchivedThreads, unarchive],
  );

  const renderRow = (
    thread: EnvironmentThreadShell,
    options: { readonly nested: boolean; readonly subagentCount: number },
  ) => (
    <SettingsRow
      key={thread.id}
      onContextMenu={(event) => openRowMenu(thread, event)}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          {options.nested ? (
            <CornerDownRightIcon className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="truncate">{thread.title}</span>
          {isArchivedSubagent(thread) ? (
            <Badge variant="outline" size="sm">
              Subagent
            </Badge>
          ) : null}
        </span>
      }
      description={
        <>
          Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.updatedAt)}
          {" · Last active "}
          {formatRelativeTimeLabel(archivedThreadLastActivityAt(thread))}
          {options.subagentCount > 0
            ? ` · ${options.subagentCount} ${options.subagentCount === 1 ? "subagent" : "subagents"}`
            : null}
        </>
      }
      control={
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="shrink-0"
          onClick={() => void unarchive(scopeThreadRef(thread.environmentId, thread.id))}
        >
          <ArchiveX className="size-3.5" />
          <span>Unarchive</span>
        </Button>
      }
    />
  );

  const sortControl = (
    <Select
      value={sortOrder}
      onValueChange={(value) =>
        updateClientSettings({ archivedThreadSortOrder: value as ArchivedThreadSortOrder })
      }
    >
      <SelectTrigger size="xs" aria-label="Sort archived threads">
        <SelectValue>{SORT_LABELS[sortOrder]}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="end" alignItemWithTrigger={false}>
        {(Object.keys(SORT_LABELS) as ArchivedThreadSortOrder[]).map((order) => (
          <SelectItem key={order} value={order}>
            {SORT_LABELS[order]}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection
          id={isLoadingArchive ? undefined : searchableSetting("archive").id}
          title={searchableSetting("archive").title}
        >
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <Spinner size="sm" tone="muted" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? "Loading archived threads"
                  : archiveError
                    ? "Could not load archived threads"
                    : "No archived threads"}
              </span>
            }
            description={
              isLoadingArchive
                ? "Checking connected environments."
                : (archiveError ?? "Archived threads will appear here.")
            }
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, families }, index) => (
          <SettingsSection
            key={`${project.environmentId}:${project.id}`}
            id={index === 0 ? searchableSetting("archive").id : undefined}
            title={project.title}
            icon={<ProjectFavicon project={project} />}
            headerAction={index === 0 ? sortControl : undefined}
          >
            {families.flatMap(({ thread, subagents }) => [
              renderRow(thread, { nested: false, subagentCount: subagents.length }),
              ...subagents.map((subagent) =>
                renderRow(subagent, { nested: true, subagentCount: 0 }),
              ),
            ])}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
