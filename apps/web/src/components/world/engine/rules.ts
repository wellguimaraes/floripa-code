import type { CharacterFactMatch, WorldDefinition, WorldIntent } from "../definition/types";
import type { CharacterFacts } from "./facts";

/** The first rule whose every listed fact matches wins; otherwise the fallback. */
export function resolveIntent(facts: CharacterFacts, definition: WorldDefinition): WorldIntent {
  const rule = definition.rules.find((candidate) => matchesFacts(candidate.when, facts));
  if (rule === undefined) return definition.fallback;
  const { when: _when, ...intent } = rule;
  return intent;
}

export function matchesFacts(match: CharacterFactMatch, facts: CharacterFacts): boolean {
  return (
    matchesValue(match.status, facts.status) &&
    matchesValue(match.provider, facts.provider) &&
    (match.unread === undefined || match.unread === facts.unread) &&
    (match.kid === undefined || match.kid === facts.kid) &&
    (match.hasWorkingKids === undefined || match.hasWorkingKids === facts.hasWorkingKids) &&
    (match.backgroundTask === undefined || match.backgroundTask === facts.backgroundTask) &&
    (match.quiet === undefined || match.quiet === facts.quiet)
  );
}

function matchesValue<T extends string>(
  expected: T | ReadonlyArray<T> | undefined,
  actual: T,
): boolean {
  if (expected === undefined) return true;
  return typeof expected === "string" ? expected === actual : expected.includes(actual);
}
