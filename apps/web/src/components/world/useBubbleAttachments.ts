import {
  type ChatAttachment,
  type EnvironmentId,
  type OrchestrationMessageContext,
  getProviderAttachmentLimitError,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { fileAttachmentTooLargeMessage } from "@t3tools/client-runtime/state/attachments";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type ComposerFileAttachment,
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  useComposerDraftStore,
} from "../../composerDraftStore";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  readAttachmentUpload,
  releaseDraftAttachments,
  retryAttachmentUpload,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { prepareImageForAttachment, readFileAsDataUrl } from "../../lib/imageCompression";
import { randomUUID } from "../../lib/utils";
import { buildMessageContext } from "../../lib/composerContextRecords";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../../state/server";
import { videoMimeType } from "../../types";
import {
  classifyComposerAttachmentFile,
  fileAttachmentStagingLimit,
  normalizeComposerImageFileMimeType,
} from "../chat/composerAttachmentFiles";
import { composerContextRecordsFromDraft } from "../composerContextPresentation";

export type BubbleAttachment = ComposerImageAttachment | ComposerFileAttachment;

/** A bubble's message as it goes out: its text, files, and the context its chips point into. */
export interface OutgoingMessage {
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment | UploadChatAttachment>;
  readonly context?: OrchestrationMessageContext;
}

function readUploadCapabilities(environmentId: EnvironmentId) {
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId) ?? null;
  const supportsAttachmentUploads = config?.environment.capabilities.attachmentUploads === true;
  return {
    supportsAttachmentUploads,
    supportsInlineMessageContext: config?.environment.capabilities.inlineMessageContext === true,
    fileLimit: fileAttachmentStagingLimit({
      attachmentUploadsCapabilityKnown: config !== null,
      supportsAttachmentUploads,
      maxFileAttachmentBytes:
        config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
    }),
  };
}

/** Drops any server-side upload and the local preview. */
function discard(attachments: ReadonlyArray<BubbleAttachment>) {
  releaseDraftAttachments(attachments);
  for (const attachment of attachments) {
    if (attachment.type === "image") URL.revokeObjectURL(attachment.previewUrl);
  }
}

/**
 * Files staged in a world reply bubble. Same rules as the chat composer:
 * images are downscaled to the wire cap, other files need a server that
 * accepts uploads. Whatever is still staged when the bubble goes away is
 * released, unless it was sent or handed to the full chat.
 */
export function useBubbleAttachments(environmentId: EnvironmentId) {
  const [attachments, setAttachments] = useState<BubbleAttachment[]>([]);
  const [preparing, setPreparing] = useState(0);
  const owned = useRef<BubbleAttachment[]>([]);
  useEffect(() => {
    owned.current = attachments;
  }, [attachments]);
  useEffect(() => () => discard(owned.current), []);

  // What the text box's chips show, keyed by the id each chip carries.
  const records = useMemo(
    () =>
      composerContextRecordsFromDraft({
        terminalContexts: [],
        images: attachments.filter((attachment) => attachment.type === "image"),
        files: attachments.filter((attachment) => attachment.type === "file"),
      }),
    [attachments],
  );

  /** Stages files; resolves to what was staged and an error to show, if any. */
  const add = async (
    files: ReadonlyArray<File>,
  ): Promise<{ staged: BubbleAttachment[]; error: string | null }> => {
    const { fileLimit } = readUploadCapabilities(environmentId);
    let error: string | null = null;
    let room = PROVIDER_SEND_TURN_MAX_ATTACHMENTS - owned.current.length;
    const images: File[] = [];
    const staged: BubbleAttachment[] = [];
    for (const file of files) {
      if (room <= 0) {
        error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} files per message.`;
        break;
      }
      const kind = classifyComposerAttachmentFile(file);
      if (kind === "unsupported-image") {
        error = `'${file.name}' is not a supported image type.`;
        continue;
      }
      if (kind === "image") {
        images.push(normalizeComposerImageFileMimeType(file));
        room -= 1;
        continue;
      }
      if (fileLimit === null) {
        error = "This server does not accept file attachments.";
        continue;
      }
      if (file.size <= 0) {
        error = `'${file.name}' is empty or could not be read.`;
        continue;
      }
      if (file.size > fileLimit) {
        error = fileAttachmentTooLargeMessage(file.name, fileLimit);
        continue;
      }
      const mimeType =
        videoMimeType({ name: file.name, mimeType: file.type }) ??
        (file.type || "application/octet-stream");
      staged.push({
        type: "file",
        id: randomUUID(),
        name: file.name || "file",
        mimeType,
        sizeBytes: file.size,
        file:
          file.type === mimeType
            ? file
            : new File([file], file.name, { type: mimeType, lastModified: file.lastModified }),
      });
      room -= 1;
    }
    if (staged.length > 0) setAttachments((current) => [...current, ...staged]);
    if (images.length === 0) return { staged, error };

    setPreparing((count) => count + images.length);
    try {
      for (const file of images) {
        const prepared = await prepareImageForAttachment(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
        if (!prepared.ok) {
          error =
            prepared.reason === "unreadable"
              ? `'${file.name}' could not be read as an image.`
              : `'${file.name}' is too large to attach.`;
          continue;
        }
        const image: ComposerImageAttachment = {
          type: "image",
          id: randomUUID(),
          name: prepared.file.name || "image",
          mimeType: prepared.file.type,
          sizeBytes: prepared.file.size,
          previewUrl: URL.createObjectURL(prepared.file),
          file: prepared.file,
        };
        staged.push(image);
        setAttachments((current) => [...current, image]);
      }
    } finally {
      setPreparing((count) => count - images.length);
    }
    return { staged, error };
  };

  const remove = (id: string) => {
    const attachment = owned.current.find((candidate) => candidate.id === id);
    if (attachment === undefined) return;
    discard([attachment]);
    setAttachments((current) => current.filter((candidate) => candidate.id !== id));
  };

  /** The files as the server takes them: uploaded where it can, else inline images. */
  const prepareFiles = async (
    staged: ReadonlyArray<BubbleAttachment>,
  ): Promise<Array<ChatAttachment | UploadChatAttachment>> => {
    const limitError = getProviderAttachmentLimitError(staged);
    if (limitError !== undefined) throw new Error(limitError);
    const { supportsAttachmentUploads } = readUploadCapabilities(environmentId);
    if (supportsAttachmentUploads) {
      for (const attachment of staged) {
        const upload = { environmentId, image: attachment };
        if (readAttachmentUpload(attachment.id)?.status === "failed") {
          retryAttachmentUpload(upload);
        } else {
          startAttachmentUpload(upload);
        }
      }
      await awaitAttachmentUploads(staged.map((attachment) => attachment.id));
      const uploaded = getUploadedAttachments({ environmentId, images: staged });
      if (uploaded === null) throw new Error("An attachment failed to upload. Try again.");
      return uploaded;
    }
    if (staged.some((attachment) => attachment.type === "file")) {
      throw new Error("This server does not accept file attachments. Remove them to send.");
    }
    return Promise.all(
      staged.flatMap((attachment) =>
        attachment.type === "image"
          ? [
              readFileAsDataUrl(attachment.file).then((dataUrl) => ({
                type: "image" as const,
                id: attachment.id,
                name: attachment.name,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
                dataUrl,
              })),
            ]
          : [],
      ),
    );
  };

  /**
   * The message to send with the given text: the staged files, and the records that bind the
   * text's chips to them. Throws with a reason it can't send.
   */
  const prepareForSend = async (text: string): Promise<OutgoingMessage> => {
    const staged = owned.current;
    if (staged.length === 0) return { text, attachments: [] };
    const attachments = await prepareFiles(staged);
    // Bound by the id the server knows: the upload's, or the local one on the data-URL path.
    const context = buildMessageContext({
      terminalContexts: [],
      reviewComments: [],
      previewAnnotations: [],
      attachments: staged.map((attachment, index) => ({
        attachment,
        attachmentId: attachments[index]?.id ?? attachment.id,
      })),
    });
    if (context === undefined) return { text, attachments };
    // A server without inline context drops the records, so the chips go out as their names.
    if (!readUploadCapabilities(environmentId).supportsInlineMessageContext) {
      return {
        text: serializeLegacyContextMessage({ text, records: context.records }),
        attachments,
      };
    }
    return { text, attachments, context };
  };

  /** The message went out: drop the staged files the way the chat composer does. */
  const sent = () => {
    discard(owned.current);
    owned.current = [];
    setAttachments([]);
  };

  /** Moves staged files into a thread's composer draft, which owns them from then on. */
  const handOff = (target: ComposerThreadTarget) => {
    const staged = owned.current;
    if (staged.length === 0) return;
    const draft = useComposerDraftStore.getState();
    const images = staged.filter((attachment) => attachment.type === "image");
    const files = staged.filter((attachment) => attachment.type === "file");
    const taken = new Set([
      ...(images.length > 0 ? draft.addImages(target, images) : []),
      ...(files.length > 0 ? draft.addFiles(target, files) : []),
    ]);
    // Anything the draft refused (a duplicate, over its cap) stays ours to clean up.
    owned.current = staged.filter((attachment) => !taken.has(attachment.id));
    setAttachments(owned.current);
  };

  return {
    attachments,
    records,
    preparing: preparing > 0,
    add,
    remove,
    prepareForSend,
    sent,
    handOff,
  };
}
