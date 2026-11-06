import type {
  CodeIntelligenceDefinitionResult,
  CodeIntelligenceLocation,
  CodeIntelligenceUnavailable,
} from "@t3tools/contracts";

/**
 * Where to ask the language server about a token: its first non-space
 * character, since a highlighted token can carry the whitespace before it.
 */
export function tokenPosition(token: {
  readonly lineNumber: number;
  readonly lineCharStart: number;
  readonly tokenText: string;
}): { readonly line: number; readonly character: number } {
  const leading = token.tokenText.length - token.tokenText.trimStart().length;
  return { line: token.lineNumber, character: token.lineCharStart + leading };
}

/** Identifiers, keywords and literals have something to look up; punctuation does not. */
export function isLookupToken(text: string): boolean {
  return /[\p{L}\p{N}_$]/u.test(text);
}

export type DefinitionOutcome =
  | { readonly kind: "open"; readonly location: CodeIntelligenceLocation }
  | { readonly kind: "pick"; readonly locations: ReadonlyArray<CodeIntelligenceLocation> }
  | { readonly kind: "message"; readonly text: string };

/**
 * What a go-to-definition click does: jump straight to a single result, offer
 * a choice between several, or say why there is nowhere to go.
 */
export function definitionOutcome(result: CodeIntelligenceDefinitionResult): DefinitionOutcome {
  if (result.status === "unavailable") return { kind: "message", text: unavailableMessage(result) };
  const [first, ...rest] = result.locations;
  if (first === undefined) return { kind: "message", text: "No definition found." };
  return rest.length === 0
    ? { kind: "open", location: first }
    : { kind: "pick", locations: result.locations };
}

export function unavailableMessage(result: CodeIntelligenceUnavailable): string {
  if (result.reason === "unsupported-file") return "No language server for this file type.";
  const server = result.language === "go" ? "gopls" : "The language server";
  return result.installHint
    ? `${server} is not installed. Install it with: ${result.installHint}`
    : `${server} is not installed.`;
}

/** `src/app.ts:12` for a picker row; host paths outside the workspace stay absolute. */
export function formatLocation(location: CodeIntelligenceLocation): string {
  return `${location.path}:${location.line}`;
}
