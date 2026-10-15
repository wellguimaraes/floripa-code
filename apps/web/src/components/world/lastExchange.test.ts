import { describe, expect, it } from "vite-plus/test";

import { replyPreview } from "./lastExchange";

const texts = (preview: ReturnType<typeof replyPreview>) => ({
  head: preview.head.map((line) => line.text),
  tail: preview.tail.map((line) => line.text),
  skipped: preview.skipped,
});

describe("replyPreview", () => {
  it("keeps short replies whole", () => {
    expect(texts(replyPreview("one\n\ntwo\nthree"))).toEqual({
      head: ["one", "two", "three"],
      tail: [],
      skipped: 0,
    });
  });

  it("keeps the first and last two lines of a long reply", () => {
    expect(texts(replyPreview("a\nb\nc\nd\ne\nf\ng"))).toEqual({
      head: ["a", "b"],
      tail: ["f", "g"],
      skipped: 3,
    });
  });

  it("drops block markers, table rules, cell pipes and fences but keeps inline markdown", () => {
    expect(
      texts(
        replyPreview(
          "## Done\n| a | b |\n|---|---|\n- **Fixed** `x`\n```ts\ncode\n```\n---\n> quoted\nnote\n1. kept",
        ),
      ),
    ).toEqual({
      head: ["Done", "a · b"],
      tail: ["note", "1\\. kept"],
      skipped: 3,
    });
  });
});
