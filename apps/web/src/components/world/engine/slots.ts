import type { FixedArea, Vec3, WorldDefinition, WorldIntent } from "../definition/types";
import type { CharacterFacts } from "./facts";
import { hashString } from "./hash";

export interface Placement {
  readonly area: string;
  /** Index into the area's slots or offsets; past the end means overflow. */
  readonly slotIndex: number;
  readonly position: Vec3;
  readonly facing: number;
  /** See `WorldSlot.seat`. */
  readonly seat?: number;
  /** See `WorldSlot.via`. */
  readonly via?: Vec3;
  /** See `WorldSlot.fishing`. */
  readonly fishing?: boolean;
  /** See `WorldSlot.ledge`. */
  readonly ledge?: boolean;
  /** Road node a character walks through to reach this spot. */
  readonly entry: string;
}

/** A wish for one slot; honoured when the character lands in that area and it is free. */
export interface SlotRequest {
  readonly area: string;
  readonly slotIndex: number;
}

export interface PlacementInput {
  readonly facts: CharacterFacts;
  readonly intent: WorldIntent;
}

export interface PlacedCharacter {
  readonly placement: Placement;
  /** The fallback replaces the intent when an anchored area has no placed parent. */
  readonly intent: WorldIntent;
}

const OVERFLOW_SPACING = 0.9;

/**
 * Gives every character a spot in its intended area. A character keeps the
 * slot it already had when it stays in the same area, so arrivals and
 * departures never reshuffle everyone else. New arrivals start from a slot
 * picked by their key, so the same thread tends to get the same spot. Areas
 * that line up (see `FixedArea.lineUp`) instead close ranks as anyone leaves.
 * Either way an agent and its subagents in the same area sit side by side.
 */
export function placeCharacters(input: {
  readonly characters: ReadonlyArray<PlacementInput>;
  readonly definition: WorldDefinition;
  readonly previous: ReadonlyMap<string, Placement>;
  /** Slots asked for by character key, e.g. the pile a new agent was started from. */
  readonly requested?: ReadonlyMap<string, SlotRequest>;
}): Map<string, PlacedCharacter> {
  const { definition, previous } = input;
  const placed = new Map<string, PlacedCharacter>();
  const occupied = new Map<string, Set<number>>();
  const taken = (area: string) => {
    let slots = occupied.get(area);
    if (slots === undefined) {
      slots = new Set();
      occupied.set(area, slots);
    }
    return slots;
  };

  const familyOf = familyRoots(input.characters);
  const fixed: PlacementInput[] = [];
  let anchored: PlacementInput[] = [];
  for (const character of input.characters) {
    const area = definition.areas[character.intent.go];
    if (area?.kind === "anchored" && character.facts.parentKey !== null) {
      anchored.push(character);
    } else if (area?.kind === "fixed") {
      fixed.push(character);
    } else {
      fixed.push({ ...character, intent: definition.fallback });
    }
  }

  const placeFixed = (characters: ReadonlyArray<PlacementInput>) => {
    for (const [areaId, members] of groupBy(characters, (c) => c.intent.go)) {
      const area = definition.areas[areaId] as FixedArea;
      const slots = taken(areaId);
      const chosen = area.lineUp
        ? lineUp(members, area, slots, familyOf)
        : settle({
            members,
            areaId,
            area,
            slots,
            previous,
            requested: input.requested,
            familyOf,
          });
      for (const [character, slotIndex] of chosen) {
        placed.set(character.facts.key, {
          intent: character.intent,
          placement: fixedPlacement(definition, areaId, area, slotIndex),
        });
      }
    }
  };
  placeFixed(fixed);

  // Kids anchor to their parent, which may itself be anchored; place in waves.
  while (anchored.length > 0) {
    const ready = anchored.filter((c) => placed.has(c.facts.parentKey!));
    if (ready.length === 0) break;
    anchored = anchored.filter((c) => !placed.has(c.facts.parentKey!));
    for (const [parentKey, kids] of groupBy(ready, (c) => c.facts.parentKey!)) {
      const parent = placed.get(parentKey)!.placement;
      for (const [areaId, members] of groupBy(kids, (c) => c.intent.go)) {
        const area = definition.areas[areaId];
        if (area?.kind !== "anchored") continue;
        const slots = taken(`${areaId}\u0000${parentKey}`);
        const ordered = stickyFirst(members, areaId, area.offsets.length, previous);
        // Offsets are in the parent's frame: +z is the way the parent faces.
        const sin = Math.sin(parent.facing);
        const cos = Math.cos(parent.facing);
        for (const { character, keep } of ordered) {
          const slotIndex = keep !== null && !slots.has(keep) ? keep : firstFree(slots);
          slots.add(slotIndex);
          const offset = area.offsets[slotIndex % area.offsets.length]!;
          const row = Math.floor(slotIndex / area.offsets.length);
          const x = offset.position[0];
          const z = offset.position[2] - row * OVERFLOW_SPACING;
          placed.set(character.facts.key, {
            intent: character.intent,
            placement: {
              area: areaId,
              slotIndex,
              position: [
                parent.position[0] + x * cos + z * sin,
                parent.position[1] + offset.position[1],
                parent.position[2] - x * sin + z * cos,
              ],
              facing: parent.facing + offset.facing,
              entry: parent.entry,
            },
          });
        }
      }
    }
  }
  // Anything left has a parent that never got placed (a lineage cycle).
  placeFixed(anchored.map((character) => ({ ...character, intent: definition.fallback })));

  return placed;
}

function fixedPlacement(
  definition: WorldDefinition,
  areaId: string,
  area: FixedArea,
  slotIndex: number,
): Placement {
  const spillover = area.spillover ?? [];
  const slot = area.slots[slotIndex] ?? spillover[slotIndex - area.slots.length];
  if (slot !== undefined) {
    return { area: areaId, slotIndex, ...slot, entry: area.entry };
  }
  // Full area: queue up in rows beside the entry instead of stacking.
  const entry = definition.roads.nodes[area.entry]!;
  const overflow = slotIndex - area.slots.length - spillover.length;
  return {
    area: areaId,
    slotIndex,
    position: [
      entry[0] + ((overflow % 4) - 1.5) * OVERFLOW_SPACING,
      entry[1],
      entry[2] + (Math.floor(overflow / 4) + 1) * OVERFLOW_SPACING,
    ],
    facing: 0,
    entry: area.entry,
  };
}

/**
 * Lines `members` up by when their agent last replied: the free slots fill in
 * order, oldest first, and the oldest who do not fit take the spillover. A
 * family lines up as one block, placed by its latest reply.
 */
function lineUp(
  members: ReadonlyArray<PlacementInput>,
  area: FixedArea,
  slots: Set<number>,
  familyOf: (character: PlacementInput) => string,
): Map<PlacementInput, number> {
  const latestReply = new Map<string, string>();
  for (const character of members) {
    const family = familyOf(character);
    const reply = character.facts.lastReplyAt;
    if ((latestReply.get(family) ?? "") < reply) latestReply.set(family, reply);
  }
  const line = members.toSorted((a, b) => {
    const [familyA, familyB] = [familyOf(a), familyOf(b)];
    return (
      latestReply.get(familyA)!.localeCompare(latestReply.get(familyB)!) ||
      familyA.localeCompare(familyB) ||
      a.facts.lastReplyAt.localeCompare(b.facts.lastReplyAt) ||
      a.facts.key.localeCompare(b.facts.key)
    );
  });
  const front = area.slots.flatMap((_, index) => (slots.has(index) ? [] : [index]));
  const behind = Math.max(0, line.length - front.length);
  const chosen = new Map<PlacementInput, number>();
  let back = area.slots.length;
  line.forEach((character, index) => {
    while (slots.has(back)) back += 1;
    const slotIndex = index < behind ? back : front[index - behind]!;
    slots.add(slotIndex);
    chosen.set(character, slotIndex);
  });
  return chosen;
}

/**
 * Everyone keeps the slot they had while it stays free; newcomers take the
 * free slot nearest their family, else the slot they asked for or one picked
 * by their key. With `worktreeReach`,
 * agents sharing a worktree keep within reach of each other: one cut off from
 * the rest moves in beside them, and a neighbour outside any worktree moves
 * aside when no slot there is free.
 */
function settle(input: {
  readonly members: ReadonlyArray<PlacementInput>;
  readonly areaId: string;
  readonly area: FixedArea;
  readonly slots: Set<number>;
  readonly previous: ReadonlyMap<string, Placement>;
  readonly requested: ReadonlyMap<string, SlotRequest> | undefined;
  readonly familyOf: (character: PlacementInput) => string;
}): Map<PlacementInput, number> {
  const { area, areaId, slots } = input;
  const count = area.slots.length;
  const spots = count + (area.spillover?.length ?? 0);
  const ordered = stickyFirst(input.members, areaId, spots, input.previous);

  // A worktree only binds agents while two or more of them share it here.
  const reach = area.worktreeReach;
  const crewSizes = new Map<string, number>();
  for (const { facts } of input.members) {
    if (reach === undefined || facts.worktreePath === null) continue;
    crewSizes.set(facts.worktreePath, (crewSizes.get(facts.worktreePath) ?? 0) + 1);
  }
  const crewOf = (character: PlacementInput) => {
    const path = character.facts.worktreePath;
    return path !== null && (crewSizes.get(path) ?? 0) > 1 ? path : null;
  };
  const near = (a: number, b: number) => {
    if (reach === undefined || a >= count || b >= count) return false;
    const [ax, , az] = area.slots[a]!.position;
    const [bx, , bz] = area.slots[b]!.position;
    return Math.hypot(ax - bx, az - bz) <= reach;
  };

  const chosen = new Map<PlacementInput, number>();
  const occupants = new Map<number, PlacementInput>();
  const take = (character: PlacementInput, slotIndex: number) => {
    slots.add(slotIndex);
    chosen.set(character, slotIndex);
    occupants.set(slotIndex, character);
  };

  const kept = new Map<PlacementInput, number>();
  const claimed = new Set<number>();
  for (const { character, keep } of ordered) {
    if (keep === null || slots.has(keep) || claimed.has(keep)) continue;
    kept.set(character, keep);
    claimed.add(keep);
  }
  // Of a worktree's agents, only the biggest group within reach stays put.
  for (const crew of new Set([...kept.keys()].map(crewOf))) {
    if (crew === null) continue;
    const crewKept = [...kept].filter(([character]) => crewOf(character) === crew);
    const cluster = biggestCluster(
      crewKept.map(([, slotIndex]) => slotIndex),
      near,
    );
    for (const [character, slotIndex] of crewKept) {
      if (!cluster.has(slotIndex)) kept.delete(character);
    }
  }
  for (const [character, slotIndex] of kept) take(character, slotIndex);

  for (const { character } of ordered) {
    if (chosen.has(character)) continue;
    const { key } = character.facts;
    const asked = input.requested?.get(key);
    const askedSlot =
      asked !== undefined &&
      asked.area === areaId &&
      asked.slotIndex < count &&
      !slots.has(asked.slotIndex)
        ? asked.slotIndex
        : null;
    const crew = crewOf(character);
    const mates = [...chosen].flatMap(([other, slotIndex]) =>
      crew !== null && crewOf(other) === crew ? [slotIndex] : [],
    );
    if (mates.length === 0) {
      const family = input.familyOf(character);
      const kin = [...chosen].flatMap(([other, slotIndex]) =>
        slotIndex < count && input.familyOf(other) === family ? [slotIndex] : [],
      );
      take(character, closestFree(area, slots, kin) ?? askedSlot ?? freeSlot(slots, count, key));
      continue;
    }
    const beside = (slotIndex: number) => mates.some((mate) => near(mate, slotIndex));
    const free =
      askedSlot !== null && beside(askedSlot)
        ? askedSlot
        : freeSlotWhere(slots, count, key, beside);
    if (free !== null) {
      take(character, free);
      continue;
    }
    const bystander = [...occupants].find(
      ([slotIndex, other]) => crewOf(other) === null && beside(slotIndex),
    );
    if (bystander === undefined) {
      take(character, freeSlot(slots, count, key));
      continue;
    }
    const [slotIndex, other] = bystander;
    take(character, slotIndex);
    take(other, freeSlot(slots, count, other.facts.key));
  }
  return chosen;
}

/** The free slot nearest any of `to`, the lowest index winning ties; null when none is. */
function closestFree(
  area: FixedArea,
  slots: ReadonlySet<number>,
  to: ReadonlyArray<number>,
): number | null {
  let closest: number | null = null;
  let closestDistance = Infinity;
  for (const [index, slot] of area.slots.entries()) {
    if (slots.has(index)) continue;
    for (const other of to) {
      const [x, , z] = area.slots[other]!.position;
      const distance = Math.hypot(slot.position[0] - x, slot.position[2] - z);
      if (distance >= closestDistance) continue;
      closest = index;
      closestDistance = distance;
    }
  }
  return closest;
}

/** Each character's family: its topmost ancestor in the world, else itself. */
function familyRoots(
  characters: ReadonlyArray<PlacementInput>,
): (character: PlacementInput) => string {
  const parents = new Map(characters.map(({ facts }) => [facts.key, facts.parentKey]));
  return ({ facts }) => {
    let key = facts.key;
    // Bounded, so a lineage cycle cannot spin forever.
    for (let depth = 0; depth < 32; depth += 1) {
      const parent = parents.get(key);
      if (parent == null || !parents.has(parent)) break;
      key = parent;
    }
    return key;
  };
}

/** The biggest group of `slots` linked by `near`, the earliest listed winning ties. */
function biggestCluster(
  slots: ReadonlyArray<number>,
  near: (a: number, b: number) => boolean,
): Set<number> {
  let biggest = new Set<number>();
  const seen = new Set<number>();
  for (const start of slots) {
    if (seen.has(start)) continue;
    const cluster = new Set([start]);
    const queue = [start];
    for (let slot = queue.pop(); slot !== undefined; slot = queue.pop()) {
      for (const other of slots) {
        if (cluster.has(other) || !near(slot, other)) continue;
        cluster.add(other);
        queue.push(other);
      }
    }
    for (const slot of cluster) seen.add(slot);
    if (cluster.size > biggest.size) biggest = cluster;
  }
  return biggest;
}

function stickyFirst(
  members: ReadonlyArray<PlacementInput>,
  areaId: string,
  slotCount: number,
  previous: ReadonlyMap<string, Placement>,
): Array<{ character: PlacementInput; keep: number | null }> {
  return members
    .map((character) => {
      const before = previous.get(character.facts.key);
      const keep =
        before !== undefined && before.area === areaId && before.slotIndex < slotCount
          ? before.slotIndex
          : null;
      return { character, keep };
    })
    .toSorted((a, b) => {
      if ((a.keep === null) !== (b.keep === null)) return a.keep === null ? 1 : -1;
      return (
        a.character.facts.createdAt.localeCompare(b.character.facts.createdAt) ||
        a.character.facts.key.localeCompare(b.character.facts.key)
      );
    });
}

function freeSlot(slots: ReadonlySet<number>, slotCount: number, key: string): number {
  const free = freeSlotWhere(slots, slotCount, key, () => true);
  if (free !== null) return free;
  let overflow = slotCount;
  while (slots.has(overflow)) overflow += 1;
  return overflow;
}

/** A free slot passing `allowed`, searched from one picked by `key`; null when none is. */
function freeSlotWhere(
  slots: ReadonlySet<number>,
  slotCount: number,
  key: string,
  allowed: (slotIndex: number) => boolean,
): number | null {
  if (slotCount === 0) return null;
  const preferred = hashString(key) % slotCount;
  for (let step = 0; step < slotCount; step += 1) {
    const candidate = (preferred + step) % slotCount;
    if (!slots.has(candidate) && allowed(candidate)) return candidate;
  }
  return null;
}

function firstFree(slots: ReadonlySet<number>): number {
  let index = 0;
  while (slots.has(index)) index += 1;
  return index;
}

function groupBy<T>(items: ReadonlyArray<T>, key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [item]);
    else group.push(item);
  }
  return groups;
}
