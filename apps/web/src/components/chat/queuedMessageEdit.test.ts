import {
  EnvironmentId,
  MessageId,
  type OrchestrationMessageContext,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  DraftId,
  useComposerDraftStore,
  type ComposerFileAttachment,
  type ComposerImageAttachment,
} from "../../composerDraftStore";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "./composerPromptHistory";
import {
  prepareQueuedEditAttachments,
  type QueuedRunEdit,
  queuedRunEditCommandInput,
  recoverQueuedMessageEdit,
} from "./queuedMessageEdit";

const environmentId = EnvironmentId.make("remote-environment");
const threadTarget = scopeThreadRef(environmentId, ThreadId.make("thread:edit"));
const editTarget = DraftId.make("queued-edit:test");
const file: ComposerFileAttachment = {
  type: "file",
  id: "file:report",
  name: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 6,
  file: new File(["report"], "report.pdf", { type: "application/pdf" }),
};
const image: ComposerImageAttachment = {
  type: "image",
  id: "image:screen",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 5,
  file: new File(["image"], "screen.png", { type: "image/png" }),
  previewUrl: "blob:screen",
};
const uploadedFile = {
  type: "file" as const,
  id: "upload:report",
  name: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
};

describe("queued message file edits", () => {
  beforeEach(() => {
    useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  });

  it.each([
    { images: [], label: "file-only" },
    { images: [image], label: "mixed" },
  ])("preserves a generic file in a $label save", async ({ images }) => {
    const attachments = await prepareQueuedEditAttachments({
      existingAttachments: [],
      images,
      files: [file],
      uploadFiles: async () => [uploadedFile],
      readImage: async () => "data:image/png;base64,aW1hZ2U=",
    });
    expect(attachments.at(-1)).toEqual(uploadedFile);
    expect(attachments.length).toBe(images.length + 1);
    if (images.length > 0)
      expect(attachments[0]).toMatchObject({
        type: "image",
        dataUrl: "data:image/png;base64,aW1hZ2U=",
      });
  });

  it("retains saved attachments alongside newly uploaded files", async () => {
    const saved = { ...uploadedFile, id: "saved:earlier" };
    const attachments = await prepareQueuedEditAttachments({
      existingAttachments: [saved],
      images: [],
      files: [file],
      uploadFiles: async () => [uploadedFile],
      readImage: async () => "unused",
    });
    expect(attachments).toEqual([saved, uploadedFile]);
  });

  it("fails a save instead of dropping a file whose upload is missing", async () => {
    await expect(
      prepareQueuedEditAttachments({
        existingAttachments: [],
        images: [image],
        files: [file],
        uploadFiles: async () => [],
        readImage: async () => "image",
      }),
    ).rejects.toThrow("Retry or remove");
  });

  it("keeps file-only edits when another client starts the queued run", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(editTarget, "Original message");
    store.addFiles(editTarget, [file]);
    expect(
      recoverQueuedMessageEdit({ editTarget, threadTarget, originalText: "Original message" }),
    ).toBe("kept");
    expect(store.getComposerDraft(threadTarget)?.prompt).toBe("Original message");
    expect(store.getComposerDraft(threadTarget)?.files).toEqual([file]);
    expect(store.getComposerDraft(editTarget)).toBeNull();
  });

  it("preserves uploaded file references when a remote queue advance interrupts the edit", () => {
    const store = useComposerDraftStore.getState();
    const uploaded = {
      ...file,
      file: null,
      uploadedAttachmentId: uploadedFile.id,
      uploadEnvironmentId: environmentId,
    };
    store.addFiles(editTarget, [uploaded]);
    expect(recoverQueuedMessageEdit({ editTarget, threadTarget, originalText: "" })).toBe("kept");
    expect(store.getComposerDraft(threadTarget)?.files).toEqual([uploaded]);
  });

  it("does not overwrite a separate draft when the queued run leaves", () => {
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadTarget, "Separate draft");
    store.addFiles(editTarget, [file]);
    expect(recoverQueuedMessageEdit({ editTarget, threadTarget, originalText: "" })).toBe(
      "discarded",
    );
    expect(store.getComposerDraft(threadTarget)?.prompt).toBe("Separate draft");
    expect(store.getComposerDraft(editTarget)).toBeNull();
  });
});

type ContextRecord = OrchestrationMessageContext["records"][number];

function imageRecord(contextId: string, attachmentId: string): ContextRecord {
  return {
    version: 1,
    kind: "image",
    contextId,
    label: attachmentId,
    attachmentId,
    name: `${attachmentId}.png`,
    mimeType: "image/png",
    sizeBytes: 5,
  } as unknown as ContextRecord;
}

function mentionRecord(contextId: string): ContextRecord {
  return { version: 1, kind: "mention", contextId, label: contextId } as unknown as ContextRecord;
}

describe("queued message edit saves", () => {
  const keptImage = { ...uploadedFile, type: "image" as const, id: "kept", mimeType: "image/png" };
  const editing: QueuedRunEdit = {
    threadId: ThreadId.make("thread:edit"),
    runId: RunId.make("run:queued"),
    messageId: MessageId.make("message:queued"),
    originalText: "Original",
    existingAttachments: [keptImage],
    context: {
      version: 1,
      records: [
        imageRecord("ctx:kept", "kept"),
        imageRecord("ctx:removed", "removed"),
        mentionRecord("ctx:mention"),
      ],
    },
  };

  it("keeps the message's context except for removed files, then adds the new draft's", () => {
    const input = queuedRunEditCommandInput({
      editing,
      text: "Edited",
      attachments: [keptImage, uploadedFile],
      newContext: {
        version: 1,
        records: [imageRecord("ctx:new", uploadedFile.id), mentionRecord("ctx:mention")],
      },
    });
    expect(input.edit.attachments).toEqual([keptImage, uploadedFile]);
    expect(input.edit.context.records.map((record) => record.contextId)).toEqual([
      "ctx:kept",
      "ctx:mention",
      "ctx:new",
    ]);
    expect(input.text).toBe("Edited");
  });

  it("sends the attachment-only prompt when the edit leaves no text", () => {
    const input = queuedRunEditCommandInput({
      editing,
      text: "",
      attachments: [keptImage],
      newContext: undefined,
    });
    expect(input.text).toBe(ATTACHMENT_ONLY_BOOTSTRAP_PROMPT);
  });
});
