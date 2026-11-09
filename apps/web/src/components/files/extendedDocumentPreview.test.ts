import { describe, expect, it } from "vite-plus/test";

import { openNotebook } from "./extendedDocumentPreview";

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
});
