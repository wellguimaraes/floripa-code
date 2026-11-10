import { EnvironmentId, type OrchestrationV2ArchivedShellSnapshot } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  type ArchivedThreadEntry,
  type ArchivedThreadFamily,
  archivedThreadFamilies,
  createArchivedThreadSnapshotsAtomFamily,
  makeArchivedThreadsEnvironmentKey,
  parseArchivedThreadsEnvironmentKey,
} from "./archivedThreads.ts";

it("round-trips environment keys in sorted order", () => {
  const envA = EnvironmentId.make("env-a");
  const envB = EnvironmentId.make("env-b");
  const key = makeArchivedThreadsEnvironmentKey([envB, envA]);

  expect(parseArchivedThreadsEnvironmentKey(key)).toEqual([envA, envB]);
});

it("does not expose an archived snapshot failure message", () => {
  const environmentId = EnvironmentId.make("env-sensitive");
  const snapshotsAtom = createArchivedThreadSnapshotsAtomFamily<Error>({
    getSnapshotAtom: () =>
      Atom.make(
        AsyncResult.failure<OrchestrationV2ArchivedShellSnapshot, Error>(
          Cause.fail(new Error("credential=secret-value")),
        ),
      ),
    labelPrefix: "test:archived-thread-snapshots",
  });
  const registry = AtomRegistry.make();

  expect(registry.get(snapshotsAtom(makeArchivedThreadsEnvironmentKey([environmentId])))).toEqual({
    snapshots: [],
    error: "Failed to load archived threads.",
    isLoading: false,
  });

  registry.dispose();
});

describe("archivedThreadFamilies", () => {
  const thread = (
    id: string,
    input: {
      readonly parent?: string;
      readonly archivedAt: string;
      readonly ranAt?: string;
    },
  ): ArchivedThreadEntry => ({
    id,
    lineage: {
      parentThreadId: input.parent ?? null,
      relationshipToParent: input.parent === undefined ? null : "subagent",
    },
    archivedAt: input.archivedAt,
    createdAt: "2026-01-01T00:00:00.000Z",
    // Archiving moves this, so it must not count as activity.
    updatedAt: input.archivedAt,
    latestRun:
      input.ranAt === undefined
        ? null
        : { requestedAt: input.ranAt, startedAt: input.ranAt, completedAt: input.ranAt },
  });
  const shape = (families: ReadonlyArray<ArchivedThreadFamily<ArchivedThreadEntry>>) =>
    families.map((family) => [family.thread.id, family.subagents.map((sub) => sub.id)]);

  it("nests subagents at any depth under their furthest archived agent", () => {
    const threads = [
      thread("agent", { archivedAt: "2026-01-05T00:00:00.000Z" }),
      thread("kid", { parent: "agent", archivedAt: "2026-01-05T00:00:01.000Z" }),
      thread("grandkid", { parent: "kid", archivedAt: "2026-01-05T00:00:02.000Z" }),
      // Its agent is still active, so it stands alone.
      thread("orphan", { parent: "active-agent", archivedAt: "2026-01-04T00:00:00.000Z" }),
    ];
    expect(shape(archivedThreadFamilies(threads, "archived_at"))).toEqual([
      ["agent", ["grandkid", "kid"]],
      ["orphan", []],
    ]);
  });

  it("orders by last run rather than archive time, either direction", () => {
    const threads = [
      thread("ran-early", {
        archivedAt: "2026-01-09T00:00:00.000Z",
        ranAt: "2026-01-02T00:00:00.000Z",
      }),
      thread("ran-late", {
        archivedAt: "2026-01-03T00:00:00.000Z",
        ranAt: "2026-01-06T00:00:00.000Z",
      }),
      thread("never-ran", { archivedAt: "2026-01-08T00:00:00.000Z" }),
    ];
    expect(shape(archivedThreadFamilies(threads, "archived_at"))).toEqual([
      ["ran-early", []],
      ["never-ran", []],
      ["ran-late", []],
    ]);
    expect(shape(archivedThreadFamilies(threads, "last_activity"))).toEqual([
      ["ran-late", []],
      ["ran-early", []],
      ["never-ran", []],
    ]);
    expect(shape(archivedThreadFamilies(threads, "last_activity", { oldestFirst: true }))).toEqual([
      ["never-ran", []],
      ["ran-early", []],
      ["ran-late", []],
    ]);
  });
});
