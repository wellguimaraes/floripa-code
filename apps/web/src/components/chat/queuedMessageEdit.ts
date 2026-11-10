import type {
  ChatAttachment,
  MessageId,
  OrchestrationMessageContext,
  RunId,
  ThreadId,
  UploadChatAttachment,
} from "@t3tools/contracts";
import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "./composerPromptHistory";

/** A queued message being edited; `existingAttachments` are the stored ones the edit keeps. */
export interface QueuedRunEdit {
  readonly threadId: ThreadId;
  readonly runId: RunId;
  readonly messageId: MessageId;
  readonly originalText: string;
  readonly existingAttachments: ReadonlyArray<ChatAttachment>;
  readonly context?: OrchestrationMessageContext | undefined;
}

/** Keep an unsaved edit when its queued run starts or is removed remotely. */
export function recoverQueuedMessageEdit(input: {
  readonly editTarget: ComposerThreadTarget;
  readonly threadTarget: ComposerThreadTarget;
  readonly originalText: string;
}): "kept" | "discarded" | "clean" {
  const store = useComposerDraftStore.getState();
  const draft = store.getComposerDraft(input.editTarget);
  const dirty =
    draft !== null &&
    (draft.prompt !== input.originalText || draft.images.length > 0 || draft.files.length > 0);
  if (dirty && !composerDraftHasUserContent(store.getComposerDraft(input.threadTarget))) {
    store.moveComposerPromptAndImages(input.editTarget, input.threadTarget);
    return "kept";
  }
  store.clearComposerContent(input.editTarget);
  return dirty ? "discarded" : "clean";
}

/** Generic files need upload references; images also support the inline transport. */
export async function prepareQueuedEditAttachments(input: {
  readonly existingAttachments: ReadonlyArray<ChatAttachment>;
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  readonly files: ReadonlyArray<ComposerFileAttachment>;
  readonly uploadFiles: (
    files: ReadonlyArray<ComposerFileAttachment>,
  ) => Promise<ReadonlyArray<ChatAttachment>>;
  readonly readImage: (file: File) => Promise<string>;
}) {
  const files = input.files.length === 0 ? [] : await input.uploadFiles(input.files);
  if (files.length !== input.files.length)
    throw new Error("Retry or remove failed uploads before saving.");
  const images = await Promise.all(
    input.images.map(async (image) => ({
      type: "image" as const,
      id: image.id,
      name: image.name,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      dataUrl: await input.readImage(image.file),
      ...(image.source ? { source: image.source } : {}),
    })),
  );
  return [...input.existingAttachments, ...images, ...files];
}

/**
 * The `editQueuedRun` input that saves an edit: the full attachment list (kept ones first, then
 * the new ones) and the context records, the kept message's own minus any for a removed file,
 * then the new draft's.
 */
export function queuedRunEditCommandInput(input: {
  readonly editing: QueuedRunEdit;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment>;
  readonly newContext: OrchestrationMessageContext | undefined;
}) {
  const { editing } = input;
  const keptRecords = (editing.context?.records ?? []).filter(
    (record) =>
      !("attachmentId" in record) ||
      editing.existingAttachments.some((attachment) => attachment.id === record.attachmentId),
  );
  const records = [
    ...new Map(
      [...keptRecords, ...(input.newContext?.records ?? [])].map(
        (record) => [record.contextId, record] as const,
      ),
    ).values(),
  ];
  return {
    threadId: editing.threadId,
    runId: editing.runId,
    text: input.text.length === 0 ? ATTACHMENT_ONLY_BOOTSTRAP_PROMPT : input.text,
    edit: {
      messageId: editing.messageId,
      attachments: input.attachments,
      context: { version: 1 as const, records },
    },
  };
}
