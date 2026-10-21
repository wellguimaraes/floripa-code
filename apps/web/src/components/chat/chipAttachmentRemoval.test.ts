import { describe, expect, it } from "vite-plus/test";

import { attachmentsWithRemovedChips } from "./chipAttachmentRemoval";

const shot = { id: "shot", contextId: "image_shot", name: "shot.png" };
const notes = { id: "notes", contextId: "file_notes", name: "notes.md" };

describe("attachmentsWithRemovedChips", () => {
  it("finds an attachment whose only chip the edit deleted", () => {
    expect(
      attachmentsWithRemovedChips(
        [shot, notes],
        new Set(["image_shot", "file_notes"]),
        new Set(["file_notes"]),
      ),
    ).toEqual([shot]);
  });

  it("ignores attachments that never had a chip or still have one", () => {
    expect(
      attachmentsWithRemovedChips([shot, notes], new Set(["file_notes"]), new Set(["file_notes"])),
    ).toEqual([]);
  });

  it("ignores a chip the edit brought back", () => {
    expect(attachmentsWithRemovedChips([shot], new Set(), new Set(["image_shot"]))).toEqual([]);
  });
});
