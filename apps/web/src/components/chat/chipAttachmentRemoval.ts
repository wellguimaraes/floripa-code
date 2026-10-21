/** A staged attachment as the prompt points at it: one chip kind, one context id. */
export interface ChipAttachment {
  id: string;
  contextId: string;
  name: string;
}

/**
 * Attachments an edit left without a chip: referenced before it, not after. An attachment
 * that never had a chip, or still has one elsewhere in the prompt, is not one of them.
 */
export function attachmentsWithRemovedChips(
  attachments: ReadonlyArray<ChipAttachment>,
  previousContextIds: ReadonlySet<string>,
  nextContextIds: ReadonlySet<string>,
): ChipAttachment[] {
  return attachments.filter(
    (attachment) =>
      previousContextIds.has(attachment.contextId) && !nextContextIds.has(attachment.contextId),
  );
}
