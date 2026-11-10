import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  MessageId,
  OrchestrationMessageContext,
  RunId,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";

import { useAssetUrls } from "../../assets/assetUrls";
import {
  DraftId,
  useComposerDraftStore,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { type QueuedRunEdit, recoverQueuedMessageEdit } from "./queuedMessageEdit";
import type { EditQueuedRunRequest } from "./QueuedRunsControl";

/**
 * Edits by thread key. Shared, so the chat panel and a world bubble on the same thread show the
 * same edit, as they already share the thread's draft.
 */
const useQueuedRunEditStore = create<{
  readonly edits: Readonly<Record<string, QueuedRunEdit>>;
  readonly set: (threadKey: string, edit: QueuedRunEdit | null) => void;
}>()((set) => ({
  edits: {},
  set: (threadKey, edit) =>
    set(({ edits }) => {
      const { [threadKey]: _previous, ...rest } = edits;
      return { edits: edit === null ? rest : { ...rest, [threadKey]: edit } };
    }),
}));

/** The per-run draft an edit types into, so the thread's own draft survives untouched. */
function editDraftTarget(threadKey: string, runId: RunId): DraftId {
  return DraftId.make(`queued-edit:${threadKey}:${runId}`);
}

/**
 * Edit mode for a thread's queued messages. While editing, the composer types into
 * `draftTarget` instead of `baseDraftTarget`, and sending saves the queued message in place
 * (`queuedRunEditCommandInput`). The edit ends by itself when its run leaves the queue: an unsaved change
 * moves into the thread's draft when that is empty, and is dropped with a toast otherwise.
 */
export function useQueuedRunEdit(input: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef | null;
  readonly baseDraftTarget: ComposerThreadTarget;
  /** The thread's runs and messages, to find the edited message's context and notice its run leave. */
  readonly projection: {
    readonly runs: ReadonlyArray<{ readonly id: RunId; readonly status: string }>;
    readonly messages: ReadonlyArray<{
      readonly id: MessageId;
      readonly context?: OrchestrationMessageContext | undefined;
    }>;
  } | null;
}) {
  const { threadRef, baseDraftTarget, projection } = input;
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const editing = useQueuedRunEditStore((state) =>
    threadKey === null ? null : (state.edits[threadKey] ?? null),
  );
  const draftTarget: ComposerThreadTarget = useMemo(
    () =>
      editing === null || threadKey === null
        ? baseDraftTarget
        : editDraftTarget(threadKey, editing.runId),
    [baseDraftTarget, editing, threadKey],
  );

  const setEdit = useCallback(
    (edit: QueuedRunEdit | null) => {
      if (threadKey !== null) useQueuedRunEditStore.getState().set(threadKey, edit);
    },
    [threadKey],
  );

  const begin = useCallback(
    (request: EditQueuedRunRequest) => {
      if (threadRef === null || threadKey === null) return;
      const drafts = useComposerDraftStore.getState();
      if (editing !== null && editing.runId !== request.runId) {
        drafts.clearComposerContent(editDraftTarget(threadKey, editing.runId));
      }
      const target = editDraftTarget(threadKey, request.runId);
      drafts.clearComposerContent(target);
      drafts.setPrompt(target, request.text);
      setEdit({
        threadId: threadRef.threadId,
        runId: request.runId,
        messageId: request.messageId,
        originalText: request.text,
        existingAttachments: request.attachments,
        context: projection?.messages.find((message) => message.id === request.messageId)?.context,
      });
    },
    [editing, projection, setEdit, threadKey, threadRef],
  );

  /** Ends the edit and drops its draft: cancelled, or saved. */
  const end = useCallback(() => {
    if (editing === null || threadKey === null) return;
    useComposerDraftStore
      .getState()
      .clearComposerContent(editDraftTarget(threadKey, editing.runId));
    setEdit(null);
  }, [editing, setEdit, threadKey]);

  const removeExistingAttachment = useCallback(
    (attachmentId: string) => {
      if (editing === null) return;
      setEdit({
        ...editing,
        existingAttachments: editing.existingAttachments.filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      });
    },
    [editing, setEdit],
  );

  useEffect(() => {
    if (editing === null || threadKey === null || projection === null) return;
    const run = projection.runs.find((candidate) => candidate.id === editing.runId);
    if (run !== undefined && run.status === "queued") return;
    // Another view of the thread may have ended it already in this same commit.
    if (useQueuedRunEditStore.getState().edits[threadKey]?.runId !== editing.runId) return;
    setEdit(null);
    const recovery = recoverQueuedMessageEdit({
      editTarget: editDraftTarget(threadKey, editing.runId),
      threadTarget: baseDraftTarget,
      originalText: editing.originalText,
    });
    if (recovery === "clean") return;
    toastManager.add(
      stackedThreadToast({
        type: recovery === "kept" ? "info" : "warning",
        title: "Queued message is no longer queued",
        description:
          recovery === "kept"
            ? "Your unsaved edit was kept in the composer."
            : "Your unsaved edit was discarded.",
      }),
    );
  }, [baseDraftTarget, editing, projection, setEdit, threadKey]);

  // The kept attachments with their image previews, for the composer to show and remove.
  const imageResources = useMemo(
    () =>
      (editing?.existingAttachments ?? [])
        .filter((attachment) => attachment.type === "image")
        .map((attachment) => ({ _tag: "attachment" as const, attachmentId: attachment.id })),
    [editing],
  );
  const imageUrls = useAssetUrls(input.environmentId, imageResources);
  const existingAttachments = useMemo(() => {
    if (editing === null) return null;
    const urlById = new Map(
      imageResources.map((resource, index) => [resource.attachmentId, imageUrls[index] ?? null]),
    );
    return editing.existingAttachments.map((attachment) => ({
      attachment,
      url: urlById.get(attachment.id) ?? null,
    }));
  }, [editing, imageResources, imageUrls]);

  return { editing, draftTarget, existingAttachments, begin, end, removeExistingAttachment };
}
