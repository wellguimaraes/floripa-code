import type { Vec3, WorldDefinition } from "../definition/types";
import type { CharacterFacts } from "./facts";
import { hashString, seededRandom } from "./hash";
import { matchesFacts, resolveIntent } from "./rules";
import type { Placement, SlotRequest } from "./slots";
import { islandVariant } from "./variety";
import { resolveWorld, type WorldCharacter } from "./world";

export interface WorldIsland {
  /** The project's key; every character on the island shares it. */
  readonly key: string;
  readonly cell: number;
  /** This island's own template, e.g. one of a bigger size. */
  readonly definition: WorldDefinition;
  /** Where the island template's origin sits in the world. */
  readonly offset: Vec3;
  readonly characters: ReadonlyArray<WorldCharacter>;
  /** Whether any character on it matches a ripple rule, e.g. one waiting on you. */
  readonly ripple: boolean;
  /** Colour index per family (a character's `lookSeed`), distinct within the island. */
  readonly hues: ReadonlyMap<string, number>;
  /**
   * Hat index per worktree folder, distinct within the island, so agents
   * sharing a worktree wear the same hat. The project checkout gets none.
   */
  readonly hats: ReadonlyMap<string, number>;
}

/** What the world remembers between updates so nothing jumps around. */
export interface ArchipelagoMemory {
  readonly cells: ReadonlyMap<string, number>;
  readonly placements: ReadonlyMap<string, Placement>;
  readonly hues: ReadonlyMap<string, number>;
  readonly hats: ReadonlyMap<string, number>;
}

export const EMPTY_ARCHIPELAGO_MEMORY: ArchipelagoMemory = {
  cells: new Map(),
  placements: new Map(),
  hues: new Map(),
  hats: new Map(),
};

/**
 * One island per project that has characters. A project keeps its grid cell
 * while it stays in the world, so islands never move when another project
 * arrives or leaves; newcomers take the first free cell in `projectOrder`.
 */
export function resolveArchipelago(input: {
  readonly facts: ReadonlyArray<CharacterFacts>;
  readonly definition: WorldDefinition;
  /**
   * The island's sizes, smallest first: each island takes the one that fits
   * its characters (see `fittingSize`). Every island is `definition` when left out.
   */
  readonly sizes?: ReadonlyArray<WorldDefinition>;
  /** Every known project key in a stable order, e.g. by name. */
  readonly projectOrder: ReadonlyArray<string>;
  /** How many family colours the renderer has. */
  readonly hueCount: number;
  /** How many hats the renderer has. */
  readonly hatCount: number;
  /** Colours picked by hand, by family seed; they win over every other rule. */
  readonly chosenHues?: Readonly<Record<string, number>>;
  readonly requested?: ReadonlyMap<string, SlotRequest>;
  /** Islands per grid row; the definition's `columns` when left out. */
  readonly columns?: number;
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
  // Every project keeps its island, empty once its last thread is archived.
  const keys = [...new Set([...input.projectOrder, ...byProject.keys()])].toSorted(
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

  const definitions = new Map(
    keys.map((key) => {
      const sized =
        input.sizes === undefined ? definition : fittingSize(input.sizes, byProject.get(key) ?? []);
      return [key, islandVariant(sized, key)] as const;
    }),
  );
  const offsets = islandOffsets({
    islands: keys.map((key) => ({
      cell: cells.get(key)!,
      radius: islandRadius(definitions.get(key)!),
      key,
    })),
    gap: definition.archipelago.gap,
    columns: input.columns ?? definition.archipelago.columns,
    ...(definition.archipelago.wander === undefined
      ? {}
      : { wander: definition.archipelago.wander }),
  });
  const placements = new Map<string, Placement>();
  const hues = new Map<string, number>();
  const hats = new Map<string, number>();
  const islands = keys.map((key, index) => {
    const islandDefinition = definitions.get(key)!;
    const characters = resolveWorld({
      facts: byProject.get(key) ?? [],
      definition: islandDefinition,
      previous: previous.placements,
      ...(input.requested === undefined ? {} : { requested: input.requested }),
    });
    for (const character of characters) placements.set(character.facts.key, character.placement);
    const cell = cells.get(key)!;
    const ripple = characters.some((character) =>
      definition.archipelago.ripple.when.some((match) => matchesFacts(match, character.facts)),
    );
    const islandHues = assignHues({
      facts: byProject.get(key) ?? [],
      hueCount: input.hueCount,
      chosen: input.chosenHues ?? {},
      previous: previous.hues,
    });
    for (const [seed, hue] of islandHues) hues.set(seed, hue);
    const islandHats = assignHats({
      facts: byProject.get(key) ?? [],
      hatCount: input.hatCount,
      previous: previous.hats,
    });
    for (const [path, hat] of islandHats) hats.set(path, hat);
    return {
      key,
      cell,
      definition: islandDefinition,
      offset: offsets[index]!,
      characters,
      ripple,
      hues: islandHues,
      hats: islandHats,
    };
  });
  return { islands, memory: { cells, placements, hues, hats } };
}

/**
 * The smallest size that leaves a slot free in every area with props at its
 * slots (the rock piles, the towels): an island grows once one fills up, and
 * shrinks back once the smaller size would have room again. The biggest when
 * none does.
 */
export function fittingSize(
  sizes: ReadonlyArray<WorldDefinition>,
  facts: ReadonlyArray<CharacterFacts>,
): WorldDefinition {
  const fits = (size: WorldDefinition) => {
    const wanted = new Map<string, number>();
    for (const character of facts) {
      const area = resolveIntent(character, size).go;
      wanted.set(area, (wanted.get(area) ?? 0) + 1);
    }
    return Object.entries(size.areas).every(
      ([id, area]) =>
        area.kind !== "fixed" ||
        area.slotProp === undefined ||
        (wanted.get(id) ?? 0) < area.slots.length,
    );
  };
  return sizes.find(fits) ?? sizes.at(-1)!;
}

/**
 * One colour per family, so a parent and its kids match and two families on
 * the same island never do (until there are more families than colours). A
 * colour picked by hand always holds; otherwise a family keeps its colour
 * while it stays, and newcomers start from a colour picked by their seed and
 * take the next free one.
 */
function assignHues(input: {
  readonly facts: ReadonlyArray<CharacterFacts>;
  readonly hueCount: number;
  readonly chosen: Readonly<Record<string, number>>;
  readonly previous: ReadonlyMap<string, number>;
}): Map<string, number> {
  return assignDistinct({
    groups: oldestFirst(input.facts.map((facts) => [facts.lookSeed, facts.createdAt])),
    count: input.hueCount,
    chosen: input.chosen,
    previous: input.previous,
  });
}

/**
 * One hat per worktree, with the same rules as family colours minus picking
 * by hand: kept while the worktree stays, distinct until hats run out.
 */
function assignHats(input: {
  readonly facts: ReadonlyArray<CharacterFacts>;
  readonly hatCount: number;
  readonly previous: ReadonlyMap<string, number>;
}): Map<string, number> {
  if (input.hatCount === 0) return new Map();
  return assignDistinct({
    groups: oldestFirst(
      input.facts.flatMap((facts) =>
        facts.worktreePath === null ? [] : [[facts.worktreePath, facts.createdAt] as const],
      ),
    ),
    count: input.hatCount,
    chosen: {},
    previous: input.previous,
  });
}

/** Group keys ordered by their earliest member, ties by key. */
function oldestFirst(members: ReadonlyArray<readonly [string, string]>): string[] {
  const firstSeen = new Map<string, string>();
  for (const [group, createdAt] of members) {
    const seen = firstSeen.get(group);
    if (seen === undefined || createdAt < seen) firstSeen.set(group, createdAt);
  }
  return [...firstSeen.keys()].toSorted(
    (a, b) => firstSeen.get(a)!.localeCompare(firstSeen.get(b)!) || a.localeCompare(b),
  );
}

/**
 * Gives each group one of `count` looks, distinct while they last: a pick by
 * hand first, then the look the group had before, then one chosen by its key,
 * moving to the next free one on a clash.
 */
function assignDistinct(input: {
  readonly groups: ReadonlyArray<string>;
  readonly count: number;
  readonly chosen: Readonly<Record<string, number>>;
  readonly previous: ReadonlyMap<string, number>;
}): Map<string, number> {
  const { groups, count, chosen, previous } = input;
  const looks = new Map<string, number>();
  const used = new Set<number>();
  for (const group of groups) {
    const look = chosen[group];
    if (look !== undefined && look < count) {
      looks.set(group, look);
      used.add(look);
    }
  }
  for (const group of groups) {
    if (looks.has(group)) continue;
    const look = previous.get(group);
    if (look !== undefined && look < count && !used.has(look)) {
      looks.set(group, look);
      used.add(look);
    }
  }
  for (const group of groups) {
    if (looks.has(group)) continue;
    const preferred = hashString(group) % count;
    let look = preferred;
    for (let step = 0; step < count; step += 1) {
      const candidate = (preferred + step) % count;
      if (!used.has(candidate)) {
        look = candidate;
        break;
      }
    }
    looks.set(group, look);
    used.add(look);
  }
  return looks;
}

/** The first colour no family on the island wears yet: the default for a new agent there. */
export function suggestHue(island: Pick<WorldIsland, "hues">, hueCount: number): number {
  const used = new Set(island.hues.values());
  for (let hue = 0; hue < hueCount; hue += 1) if (!used.has(hue)) return hue;
  return island.hues.size % hueCount;
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
 * How far the ground reaches from the middle of its bounds. Islands are round,
 * so spacing them as circles packs them far closer than their boxes would.
 */
export function islandRadius(definition: WorldDefinition): number {
  const { minX, minZ, maxX, maxZ } = islandBounds(definition);
  const [centerX, centerZ] = [(minX + maxX) / 2, (minZ + maxZ) / 2];
  return Math.max(
    0,
    ...definition.terrain.map(
      (patch) =>
        Math.hypot(patch.center[0] - centerX, patch.center[1] - centerZ) +
        (patch.shape === "disc" ? patch.radius : Math.hypot(patch.size[0] / 2, patch.size[1] / 2)),
    ),
  );
}

/**
 * Lays the grid out along the screen, not the world axes: the camera looks
 * down the (1, 1) diagonal, so (1, -1) reads as "right" and (1, 1) as "down".
 * Each cell is a slot: its column is as wide as its biggest island and its
 * row as tall, plus `wander` on every side. With some `wander`, an island
 * with a `key` sits somewhere in its slot, picked by the key, so the grid
 * doesn't look ruled; otherwise it stays in the middle. Islands never leave their slot's column
 * or row, so neighbours' ground circles keep at least `gap` of water between.
 */
export function islandOffsets(input: {
  readonly islands: ReadonlyArray<{
    readonly cell: number;
    readonly radius: number;
    readonly key?: string;
  }>;
  readonly gap: number;
  readonly columns: number;
  readonly wander?: number;
}): Vec3[] {
  const { islands, gap, columns } = input;
  const wander = input.wander ?? 0;
  const columnRadius: number[] = [];
  const rowRadius: number[] = [];
  for (const { cell, radius } of islands) {
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    columnRadius[column] = Math.max(columnRadius[column] ?? 0, radius + wander);
    rowRadius[row] = Math.max(rowRadius[row] ?? 0, radius + wander);
  }
  // How far along its axis each column's or row's middle lies from the first one's.
  const along = (radii: ReadonlyArray<number | undefined>, index: number) => {
    let distance = 0;
    for (let step = 1; step <= index; step += 1) {
      distance += (radii[step - 1] ?? 0) + gap + (radii[step] ?? 0);
    }
    return distance;
  };
  return islands.map(({ cell, radius, key }) => {
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    // Anywhere in the slot, from one edge of it to the other.
    const random = seededRandom(key === undefined ? 0 : hashString(`slot:${key}`));
    const shift = (room: number) =>
      key === undefined || wander === 0 ? 0 : (random() * 2 - 1) * room;
    const right = along(columnRadius, column) + shift(columnRadius[column]! - radius);
    const down = along(rowRadius, row) + shift(rowRadius[row]! - radius);
    return [(right + down) / Math.SQRT2, 0, (down - right) / Math.SQRT2];
  });
}

/** How the islands line up on screen: down one column, along one row, or in a grid. */
export type IslandArrangement = "column" | "row" | "grid";

/** Islands per grid row for `count` islands; a grid is about as wide as it is tall. */
export function arrangementColumns(arrangement: IslandArrangement, count: number): number {
  switch (arrangement) {
    case "column":
      return 1;
    case "row":
      return Math.max(1, count);
    case "grid":
      return Math.max(1, Math.ceil(Math.sqrt(count)));
  }
}
