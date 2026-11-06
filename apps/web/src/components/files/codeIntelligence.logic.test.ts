import { describe, expect, it } from "vite-plus/test";

import { definitionOutcome, isLookupToken, tokenPosition } from "./codeIntelligence.logic";

const location = (path: string, line: number) => ({
  path,
  line,
  character: 0,
  endLine: line,
  endCharacter: 4,
});

describe("tokenPosition", () => {
  it("skips the whitespace a highlighted token carries", () => {
    expect(tokenPosition({ lineNumber: 3, lineCharStart: 10, tokenText: "  greet" })).toEqual({
      line: 3,
      character: 12,
    });
  });
});

describe("isLookupToken", () => {
  it("looks up identifiers but not punctuation", () => {
    expect(isLookupToken("greet")).toBe(true);
    expect(isLookupToken("$state")).toBe(true);
    expect(isLookupToken("名前")).toBe(true);
    expect(isLookupToken("=>")).toBe(false);
    expect(isLookupToken(" ( ")).toBe(false);
  });
});

describe("definitionOutcome", () => {
  it("opens a single definition and offers a choice between several", () => {
    expect(
      definitionOutcome({ status: "ok", language: "go", locations: [location("main.go", 4)] }),
    ).toEqual({ kind: "open", location: location("main.go", 4) });
    const overloads = [location("a.ts", 1), location("a.ts", 2)];
    expect(
      definitionOutcome({ status: "ok", language: "typescript", locations: overloads }),
    ).toEqual({ kind: "pick", locations: overloads });
  });

  it("explains an empty answer and a missing server", () => {
    expect(definitionOutcome({ status: "ok", language: "typescript", locations: [] })).toEqual({
      kind: "message",
      text: "No definition found.",
    });
    expect(
      definitionOutcome({
        status: "unavailable",
        reason: "server-not-installed",
        language: "go",
        installHint: "go install golang.org/x/tools/gopls@latest",
      }),
    ).toEqual({
      kind: "message",
      text: "gopls is not installed. Install it with: go install golang.org/x/tools/gopls@latest",
    });
  });
});
