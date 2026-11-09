import JSZip from "jszip";
import { describe, expect, it } from "vite-plus/test";

import { openEpub, openNotebook } from "./extendedDocumentPreview";

describe("document preview contents", () => {
  const bytes = (text: string) => new TextEncoder().encode(text).buffer;

  it("reads saved notebook cells and preferred outputs without executing code", () => {
    const result = openNotebook(
      bytes(
        JSON.stringify({
          nbformat: 4,
          metadata: { language_info: { name: "python" } },
          cells: [
            { cell_type: "markdown", source: ["# Results"] },
            {
              cell_type: "code",
              source: ["print(42)"],
              outputs: [
                { output_type: "stream", text: ["\n  "] },
                { output_type: "display_data", data: {} },
                { data: { "text/html": [""] } },
                { data: { "text/html": [], "text/plain": "array fallback" } },
                { data: { "text/html": "", "text/plain": "string fallback" } },
                { data: { "text/html": "  ", "text/plain": "space fallback" } },
                { output_type: "stream", text: ["42\n"] },
                { data: { "text/html": ["<b>Results</b>"], "text/plain": ["Results"] } },
              ],
            },
          ],
        }),
      ),
    );
    expect(result).toEqual({
      type: "notebook",
      language: "python",
      cells: [
        { kind: "markdown", source: "# Results", outputs: [] },
        {
          kind: "code",
          source: "print(42)",
          outputs: [
            { kind: "text", text: "array fallback" },
            { kind: "text", text: "string fallback" },
            { kind: "text", text: "space fallback" },
            { kind: "text", text: "42\n" },
            { kind: "html", text: "<b>Results</b>" },
          ],
        },
      ],
    });
    expect(() => openNotebook(bytes('{"nbformat":3,"cells":[]}'))).toThrow("version 4");
    expect(() =>
      openNotebook(
        bytes(JSON.stringify({ nbformat: 4, cells: Array.from({ length: 501 }, () => ({})) })),
      ),
    ).toThrow("500 cells");
  });

  it("bounds EPUB markup made entirely of empty allowed elements", async () => {
    const archive = new JSZip()
      .file(
        "META-INF/container.xml",
        '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>',
      )
      .file(
        "book.opf",
        '<package><manifest><item id="a" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine>' +
          '<itemref idref="a"/>'.repeat(30) +
          "</spine></package>",
      )
      .file("chapter.xhtml", "<html><body>" + "<figcaption/>".repeat(30_000) + "</body></html>");
    await expect(openEpub(archive)).rejects.toThrow("too large");
  });

  it("reads EPUB chapters in spine order and removes active and remote content", async () => {
    const archive = new JSZip()
      .file(
        "META-INF/container.xml",
        '<container><rootfiles><rootfile full-path="Book/book.opf"/></rootfiles></container>',
      )
      .file(
        "Book/book.opf",
        '<package><manifest><item id="a" href="one.xhtml" media-type="application/xhtml+xml"/><item id="b" href="two&amp;&#x26;&#38;.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>',
      )
      .file(
        "Book/one.xhtml",
        '<html><head><title>First</title></head><body><h1>First chapter</h1><img src="cover.png" alt="Cover"/><img src="https://example.com/tracker.png"/><script>alert(1)</script><style>@import "https://example.com/style.css";</style></body></html>',
      )
      .file(
        "Book/two&&&.xhtml",
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html><head><title>Second</title></head><body><h1>Second chapter</h1><p>A&nbsp;B &copy; &mdash; &NotEqualTilde; &amp;lt;</p><img src="cover.png" alt="&copy; &NotEqualTilde;"/></body></html>',
      )
      .file(
        "Book/cover.png",
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
    const result = await openEpub(archive);
    expect(result.type).toBe("document");
    if (result.type !== "document") throw new Error("Expected document");
    expect(result.pages.map((page) => page.title)).toEqual(["Second", "First"]);
    expect(result.pages[0]!.html).toContain("A\u00a0B © — ≂̸ &amp;lt;");
    expect(result.pages[0]!.html).toContain('alt="© ≂̸"');
    expect(result.pages[1]!.html).toContain('src="data:image/png;base64,');
    expect(result.pages[1]!.html).not.toMatch(/https:|script|alert/);
  });
});
