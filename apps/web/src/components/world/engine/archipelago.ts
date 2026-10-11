import type { Vec3, WorldDefinition } from "../definition/types";
import type { CharacterFacts } from "./facts";
import { hashString } from "./hash";
import { matchesFacts } from "./rules";
import type { Placement, SlotRequest } from "./slots";
import { resolveWorld, type WorldCharacter } from "./world";

export interface WorldIsland {
  /** The project's key; every character on the island shares it. */
  readonly key: string;
  readonly cell: number;
  /** Where the island template's origin sits in the world. */
  readonly offset: Vec3;
  readonly characters: ReadonlyArray<WorldCharacter>;
  /** Someone on the island matches the definition's ripple rule. */
  readonly ripple: boolean;
  /** Everyone has been resting long enough; see `archipelago.night`. */
  readonly night: boolean;
  /** Colour index per family (a character's `lookSeed`), distinct within the island. */
  readonly hues: ReadonlyMap<string, number>;
}

/** What the world remembers between updates so nothing jumps around. */
export interface ArchipelagoMemory {
  readonly cells: ReadonlyMap<string, number>;
  readonly placements: ReadonlyMap<string, Placement>;
  readonly hues: ReadonlyMap<string, number>;
}

export const EMPTY_ARCHIPELAGO_MEMORY: ArchipelagoMemory = {
  cells: new Map(),
  placements: new Map(),
  hues: new Map(),
};

/**
 * One island per project that has characters. A project keeps its grid cell
 * while it stays in the world, so islands never move when another project
 * arrives or leaves; newcomers take the first free cell in `projectOrder`.
 */
export function resolveArchipelago(input: {
  readonly facts: ReadonlyArray<CharacterFacts>;
  readonly definition: WorldDefinition;
  /** Every known project key in a stable order, e.g. by creation time. */
  readonly projectOrder: ReadonlyArray<string>;
  /** How many family colours the renderer has. */
  readonly hueCount: number;
  /** Epoch milliseconds, for deciding whether night has fallen. */
  readonly now: number;
  readonly requested?: ReadonlyMap<string, SlotRequest>;
  readonly previous: ArchipelagoMemory;
}): { readonly islands: WorldIsland[]; readonly memory: ArchipelagoMemory } {
  const { definition, previous } = input;
  const byProject = new Map<string, CharacterFacts[]>();
  for (const facts of input.facts) {
    const group = byProject.get(facts.projectKey);
    if (group === undefined) byProject.set(facts.projectKey, [facts]);
    else group.push(facts);
  }

  const rank = new Map(input.projectOrder.map((key, index) => [key, index]));
  const keys = [...byProject.keys()].toSorted(
    (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || a.localeCompare(b),
  );
  const cells = new Map<string, number>();
  const used = new Set<number>();
  for (const key of keys) {
    const cell = previous.cells.get(key);
    if (cell !== undefined && !used.has(cell)) {
      cells.set(key, cell);
      used.add(cell);
    }
  }
  let next = 0;
  for (const key of keys) {
    if (cells.has(key)) continue;
    while (used.has(next)) next += 1;
    cells.set(key, next);
    used.add(next);
  }

  const placements = new Map<string, Placement>();
  const hues = new Map<string, number>();
  const islands = keys.map((key) => {
    const night = isNight(byProject.get(key)!, definition, input.now);
    const characters = resolveWorld({
      facts: night
        ? byProject.get(key)!.map((facts) => ({ ...facts, night }))
        : byProject.get(key)!,
      definition,
      previous: previous.placements,
      ...(input.requested === undefined ? {} : { requested: input.requested }),
    });
    for (const character of characters) placements.set(character.facts.key, character.placement);
    const cell = cells.get(key)!;
    const ripple = characters.some((character) =>
      definition.archipelago.ripple.when.some((match) => matchesFacts(match, character.facts)),
    );
    const islandHues = assignHues({
      facts: byProject.get(key)!,
      hueCount: input.hueCount,
      previous: previous.hues,
    });
    for (const [seed, hue] of islandHues) hues.set(seed, hue);
    const offset = islandOffset(cell, definition);
    return { key, cell, offset, characters, ripple, night, hues: islandHues };
  });
  return { islands, memory: { cells, placements, hues } };
}

function isNight(
  facts: ReadonlyArray<CharacterFacts>,
  definition: WorldDefinition,
  now: number,
): boolean {
  const { when, afterMinutes } = definition.archipelago.night;
  if (facts.length === 0 || !facts.every((fact) => matchesFacts(when, fact))) return false;
  const lastActive = Math.max(...facts.map((fact) => Date.parse(fact.restingSince) || 0));
  return now - lastActive >= afterMinutes * 60_000;
}

/**
 * One colour per family, so a parent and its kids match and two families on
 * the same island never do (until there are more families than colours). A
 * family keeps its colour while it stays; newcomers start from a colour
 * picked by their seed and take the next free one.
 */
function assignHues(input: {
  readonly facts: ReadonlyArray<CharacterFacts>;
  readonly hueCount: number;
  readonly previous: ReadonlyMap<string, number>;
}): Map<string, number> {
  const { hueCount, previous } = input;
  const firstSeen = new Map<string, string>();
  for (const facts of input.facts) {
    const seen = firstSeen.get(facts.lookSeed);
    if (seen === undefined || facts.createdAt < seen)
      firstSeen.set(facts.lookSeed, facts.createdAt);
  }
  const families = [...firstSeen.keys()].toSorted(
    (a, b) => firstSeen.get(a)!.localeCompare(firstSeen.get(b)!) || a.localeCompare(b),
  );
  const hues = new Map<string, number>();
  const used = new Set<number>();
  for (const family of families) {
    const hue = previous.get(family);
    if (hue !== undefined && hue < hueCount && !used.has(hue)) {
      hues.set(family, hue);
      used.add(hue);
    }
  }
  for (const family of families) {
    if (hues.has(family)) continue;
    const preferred = hashString(family) % hueCount;
    let hue = preferred;
    for (let step = 0; step < hueCount; step += 1) {
      const candidate = (preferred + step) % hueCount;
      if (!used.has(candidate)) {
        hue = candidate;
        break;
      }
    }
    hues.set(family, hue);
    used.add(hue);
  }
  return hues;
}

/** The ground one island covers in its own coordinates. */
export function islandBounds(definition: WorldDefinition): {
  readonly minX: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxZ: number;
} {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const patch of definition.terrain) {
    const [halfX, halfZ] =
      patch.shape === "disc"
        ? [patch.radius, patch.radius]
        : [patch.size[0] / 2, patch.size[1] / 2];
    minX = Math.min(minX, patch.center[0] - halfX);
    maxX = Math.max(maxX, patch.center[0] + halfX);
    minZ = Math.min(minZ, patch.center[1] - halfZ);
    maxZ = Math.max(maxZ, patch.center[1] + halfZ);
  }
  return Number.isFinite(minX)
    ? { minX, minZ, maxX, maxZ }
    : { minX: 0, minZ: 0, maxX: 0, maxZ: 0 };
}

/**
 * Lays the grid out along the screen, not the world axes: the camera looks
 * down the (1, 1) diagonal, so a column step of (s, -s) reads as "right" and
 * a row step of (s, s) as "down". Two islands then differ by
 * (s * (dc + dr), s * (dr - dc)), which clears their footprints when s covers
 * the depth plus the gap and 2s covers the width plus the gap.
 */
export function islandOffset(cell: number, definition: WorldDefinition): Vec3 {
  const { columns, gap } = definition.archipelago;
  const { minX, minZ, maxX, maxZ } = islandBounds(definition);
  const step = Math.max(maxZ - minZ + gap, (maxX - minX + gap) / 2);
  const column = cell % columns;
  const row = Math.floor(cell / columns);
  return [(column + row) * step, 0, (row - column) * step];
}
