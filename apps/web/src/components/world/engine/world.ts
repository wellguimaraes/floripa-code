import type { WorldActivity, WorldDefinition, WorldIntent } from "../definition/types";
import type { CharacterFacts } from "./facts";
import { resolveIntent } from "./rules";
import { placeCharacters, type Placement, type SlotRequest } from "./slots";

export interface WorldCharacter {
  readonly facts: CharacterFacts;
  readonly intent: WorldIntent;
  readonly activity: WorldActivity;
  readonly placement: Placement;
}

/** Where every character should be and what it should be doing there. */
export function resolveWorld(input: {
  readonly facts: ReadonlyArray<CharacterFacts>;
  readonly definition: WorldDefinition;
  readonly previous: ReadonlyMap<string, Placement>;
  readonly requested?: ReadonlyMap<string, SlotRequest>;
}): WorldCharacter[] {
  const { definition } = input;
  const placed = placeCharacters({
    characters: input.facts.map((facts) => ({ facts, intent: resolveIntent(facts, definition) })),
    definition,
    previous: input.previous,
    ...(input.requested === undefined ? {} : { requested: input.requested }),
  });
  return input.facts.map((facts) => {
    const { intent, placement } = placed.get(facts.key)!;
    return { facts, intent, placement, activity: definition.activities[intent.do]! };
  });
}
