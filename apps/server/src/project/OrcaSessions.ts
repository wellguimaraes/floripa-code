/**
 * OrcaSessions - names and open state for agent sessions run inside Orca.
 *
 * Orca (github.com/stablyai/orca) runs Claude Code and Codex in terminals, so
 * their transcripts live in the agents' own homes where the scanner already
 * finds them. Orca's profile database adds what a transcript lacks: the tab or
 * worktree name the user chose, and which sessions Orca still has open. The
 * read is read-only and best-effort: a missing install or an unreadable or
 * unfamiliar database yields an empty index.
 *
 * @module project/OrcaSessions
 */
import * as NodeSqlite from "node:sqlite";

import type { AgentSessionSource } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as HostProcess from "@t3tools/shared/HostProcess";

const DEFAULT_PROFILE_ID = "local-default";

const ProfileIndex = Schema.Struct({
  profiles: Schema.Array(Schema.Struct({ id: Schema.String })),
});

const OrcaTab = Schema.Struct({
  id: Schema.String,
  worktreeId: Schema.String,
  customTitle: Schema.optional(Schema.NullOr(Schema.String)),
  aiVaultTitle: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ agent: Schema.String, sessionId: Schema.String, title: Schema.String }),
    ),
  ),
});

/** A resume record Orca keeps for a pane whose agent it will bring back. */
const OrcaResumeRecord = Schema.Struct({
  tabId: Schema.optional(Schema.String),
  worktreeId: Schema.String,
  agent: Schema.String,
  providerSession: Schema.Struct({
    id: Schema.String,
    transcriptPath: Schema.optional(Schema.String),
  }),
});

const OrcaWorkspaceSession = Schema.Struct({
  tabsByWorktree: Schema.optional(Schema.Record(Schema.String, Schema.Array(Schema.Unknown))),
  sleepingAgentSessionsByPaneKey: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const OrcaWorktreeMeta = Schema.Struct({
  displayName: Schema.optional(Schema.String),
  displayNameIsPinned: Schema.optional(Schema.Boolean),
});

const decodeProfileIndex = Schema.decodeUnknownOption(Schema.fromJsonString(ProfileIndex));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const decodeTab = Schema.decodeUnknownOption(OrcaTab);
const decodeResumeRecord = Schema.decodeUnknownOption(OrcaResumeRecord);
const decodeWorkspaceSession = Schema.decodeUnknownOption(OrcaWorkspaceSession);
const decodeWorktreeMetaMap = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Unknown),
);
const decodeWorktreeMeta = Schema.decodeUnknownOption(OrcaWorktreeMeta);

export interface OrcaSession {
  /** The name the user gave the tab or worktree, when they gave one. */
  readonly title: string | null;
}

/** Orca sessions keyed by provider session id and by transcript path. */
export interface OrcaSessionIndex {
  readonly bySessionId: ReadonlyMap<string, OrcaSession>;
  readonly byTranscriptPath: ReadonlyMap<string, OrcaSession>;
}

function sourceOf(agent: string): AgentSessionSource | null {
  if (agent === "claude") return "claudeAgent";
  if (agent === "codex") return "codex";
  return null;
}

const sessionKey = (source: AgentSessionSource, sessionId: string) => `${source}\0${sessionId}`;

/** The Orca session for an imported transcript, if Orca knows it. */
export function findOrcaSession(
  index: OrcaSessionIndex,
  input: {
    readonly source: AgentSessionSource;
    readonly providerSessionId: string;
    readonly filePath: string;
  },
): OrcaSession | undefined {
  return (
    index.bySessionId.get(sessionKey(input.source, input.providerSessionId)) ??
    index.byTranscriptPath.get(input.filePath)
  );
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}

/**
 * Build the index from the decoded `workspaceSession` and `worktreeMeta`
 * documents of one Orca profile. Exported for tests.
 */
export function indexOrcaProfile(
  documents: { readonly workspaceSession: unknown; readonly worktreeMeta: unknown },
  into: {
    readonly bySessionId: Map<string, OrcaSession>;
    readonly byTranscriptPath: Map<string, OrcaSession>;
  },
): void {
  const session = Option.getOrNull(decodeWorkspaceSession(documents.workspaceSession));
  if (session === null) return;
  const worktreeMeta = Option.getOrElse(
    decodeWorktreeMetaMap(documents.worktreeMeta),
    (): Record<string, unknown> => ({}),
  );
  // A pinned worktree name is the user's; an automatic one follows the branch.
  const worktreeTitle = (worktreeId: string) => {
    const meta = Option.getOrNull(decodeWorktreeMeta(worktreeMeta[worktreeId]));
    return meta?.displayNameIsPinned === true ? nonEmpty(meta.displayName) : null;
  };

  const tabs = new Map<string, typeof OrcaTab.Type>();
  for (const entries of Object.values(session.tabsByWorktree ?? {})) {
    for (const entry of entries) {
      const tab = Option.getOrNull(decodeTab(entry));
      if (tab !== null) tabs.set(tab.id, tab);
    }
  }

  const add = (source: AgentSessionSource | null, sessionId: string, value: OrcaSession) => {
    if (source === null || nonEmpty(sessionId) === null) return;
    const key = sessionKey(source, sessionId);
    const existing = into.bySessionId.get(key);
    into.bySessionId.set(key, { title: existing?.title ?? value.title });
  };

  for (const tab of tabs.values()) {
    const vault = tab.aiVaultTitle;
    if (vault === null || vault === undefined) continue;
    add(sourceOf(vault.agent), vault.sessionId, {
      title: nonEmpty(tab.customTitle) ?? nonEmpty(vault.title) ?? worktreeTitle(tab.worktreeId),
    });
  }

  for (const value of Object.values(session.sleepingAgentSessionsByPaneKey ?? {})) {
    const record = Option.getOrNull(decodeResumeRecord(value));
    if (record === null) continue;
    const tab = record.tabId === undefined ? undefined : tabs.get(record.tabId);
    const entry: OrcaSession = {
      title:
        nonEmpty(tab?.customTitle) ??
        nonEmpty(tab?.aiVaultTitle?.title) ??
        worktreeTitle(record.worktreeId),
    };
    add(sourceOf(record.agent), record.providerSession.id, entry);
    const transcriptPath = nonEmpty(record.providerSession.transcriptPath);
    if (transcriptPath !== null && sourceOf(record.agent) !== null) {
      into.byTranscriptPath.set(transcriptPath, entry);
    }
  }
}

/** Orca's Electron userData directory, which follows the `orca` package name. */
const orcaUserDataCandidates = (input: {
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly homeDir: string;
}) => {
  const { path, platform, environment, homeDir } = input;
  const appData =
    platform === "darwin"
      ? path.join(homeDir, "Library", "Application Support")
      : platform === "win32"
        ? (nonEmpty(environment.APPDATA) ?? path.join(homeDir, "AppData", "Roaming"))
        : (nonEmpty(environment.XDG_CONFIG_HOME) ?? path.join(homeDir, ".config"));
  // Case-sensitive volumes can hold either spelling; see Orca's app.setName.
  return [path.join(appData, "orca"), path.join(appData, "Orca")];
};

function readProfileDocuments(databasePath: string) {
  const database = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = database
      .prepare(
        "SELECT domain, payload FROM profile_state_documents WHERE domain IN ('workspaceSession', 'worktreeMeta')",
      )
      .all();
    const documents = {
      workspaceSession: undefined as unknown,
      worktreeMeta: undefined as unknown,
    };
    for (const row of rows) {
      const payload = Option.getOrUndefined(decodeJson(row.payload));
      if (row.domain === "workspaceSession") documents.workspaceSession = payload;
      if (row.domain === "worktreeMeta") documents.worktreeMeta = payload;
    }
    return documents;
  } finally {
    database.close();
  }
}

/** Service tag for reading the local Orca install's session index. */
export class OrcaSessions extends Context.Service<
  OrcaSessions,
  { readonly read: Effect.Effect<OrcaSessionIndex> }
>()("t3/project/OrcaSessions") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const homeDir = yield* HostProcess.HomeDirectory;

  const read = Effect.gen(function* () {
    const bySessionId = new Map<string, OrcaSession>();
    const byTranscriptPath = new Map<string, OrcaSession>();
    // On a case-insensitive volume both spellings read the same database,
    // which the maps absorb.
    for (const userData of orcaUserDataCandidates({ path, platform, environment, homeDir })) {
      const indexText = yield* fileSystem
        .readFileString(path.join(userData, "orca-profile-index.json"))
        .pipe(Effect.orElseSucceed(() => ""));
      const profileIds = Option.match(decodeProfileIndex(indexText), {
        onNone: () => [DEFAULT_PROFILE_ID],
        onSome: (index) => index.profiles.map((profile) => profile.id),
      });
      for (const profileId of profileIds) {
        const databasePath = path.join(userData, "profiles", profileId, "profile-state.db");
        if (!(yield* fileSystem.exists(databasePath).pipe(Effect.orElseSucceed(() => false)))) {
          continue;
        }
        yield* Effect.try(() => readProfileDocuments(databasePath)).pipe(
          Effect.map((documents) => indexOrcaProfile(documents, { bySessionId, byTranscriptPath })),
          Effect.catch((cause) =>
            Effect.logWarning("Could not read Orca sessions", { databasePath, cause }),
          ),
        );
      }
    }
    return { bySessionId, byTranscriptPath } satisfies OrcaSessionIndex;
  }).pipe(Effect.withSpan("OrcaSessions.read"));
  return OrcaSessions.of({ read });
});

export const layer = Layer.effect(OrcaSessions, make);
