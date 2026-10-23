import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqlite from "node:sqlite";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as OrcaSessions from "./OrcaSessions.ts";

const worktreeId = "repo-1::/home/user/orca/workspaces/project/fix-login";

const readOrcaSessions = (homeDir: string) =>
  Effect.gen(function* () {
    const orca = yield* OrcaSessions.make;
    return yield* orca.read;
  }).pipe(
    Effect.provideService(HostProcess.HomeDirectory, homeDir),
    Effect.provideService(HostProcess.Platform, "linux"),
    Effect.provideService(HostProcess.Environment, {}),
  );

const writeProfileDatabase = Effect.fn("OrcaSessions.test.writeProfileDatabase")(function* (
  homeDir: string,
  documents: Record<string, unknown>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profileDir = path.join(homeDir, ".config", "orca", "profiles", "local-default");
  yield* fileSystem.makeDirectory(profileDir, { recursive: true });
  const database = new NodeSqlite.DatabaseSync(path.join(profileDir, "profile-state.db"));
  try {
    database.exec(
      "CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)",
    );
    const insert = database.prepare(
      "INSERT INTO profile_state_documents (domain, payload) VALUES (?, ?)",
    );
    for (const [domain, value] of Object.entries(documents)) {
      insert.run(domain, JSON.stringify(value));
    }
  } finally {
    database.close();
  }
});

it.layer(NodeServices.layer)("OrcaSessions", (it) => {
  it.effect("names open Orca sessions after their tab or pinned worktree", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const homeDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "floripacode-orca-" });
      yield* writeProfileDatabase(homeDir, {
        worktreeMeta: {
          [worktreeId]: { displayName: "Checkout polish", displayNameIsPinned: true },
        },
        workspaceSession: {
          tabsByWorktree: {
            [worktreeId]: [
              {
                id: "tab-claude",
                worktreeId,
                title: "✳ Claude Code",
                customTitle: "Login fix",
                aiVaultTitle: { agent: "claude", sessionId: "claude-session", title: "Fix login" },
              },
              { id: "tab-codex", worktreeId, title: "codex", customTitle: null },
              { id: "tab-broken" },
            ],
          },
          sleepingAgentSessionsByPaneKey: {
            "tab-codex:leaf-1": {
              paneKey: "tab-codex:leaf-1",
              tabId: "tab-codex",
              worktreeId,
              agent: "codex",
              providerSession: {
                key: "session_id",
                id: "codex-session",
                transcriptPath: "/home/user/.codex/sessions/rollout-codex.jsonl",
              },
              origin: "quit",
            },
            "tab-gemini:leaf-1": {
              paneKey: "tab-gemini:leaf-1",
              worktreeId,
              agent: "gemini",
              providerSession: { key: "session_id", id: "gemini-session" },
            },
          },
        },
      });

      const index = yield* readOrcaSessions(homeDir);

      expect(
        OrcaSessions.findOrcaSession(index, {
          source: "claudeAgent",
          providerSessionId: "claude-session",
          filePath: "/unrelated.jsonl",
        }),
      ).toEqual({ title: "Login fix" });
      // Claude can name the transcript differently from its session id, so the
      // hook-reported path also identifies a session.
      expect(
        OrcaSessions.findOrcaSession(index, {
          source: "codex",
          providerSessionId: "renamed",
          filePath: "/home/user/.codex/sessions/rollout-codex.jsonl",
        }),
      ).toEqual({ title: "Checkout polish" });
      expect(
        OrcaSessions.findOrcaSession(index, {
          source: "codex",
          providerSessionId: "claude-session",
          filePath: "/unrelated.jsonl",
        }),
      ).toBeUndefined();
      expect(index.bySessionId.size).toBe(2);
    }),
  );

  it.effect("treats an unreadable Orca database as no sessions", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "floripacode-orca-" });
      const profileDir = path.join(homeDir, ".config", "orca", "profiles", "local-default");
      yield* fileSystem.makeDirectory(profileDir, { recursive: true });
      yield* fileSystem.writeFileString(path.join(profileDir, "profile-state.db"), "not sqlite");

      const index = yield* readOrcaSessions(homeDir);

      expect(index.bySessionId.size).toBe(0);
      expect(index.byTranscriptPath.size).toBe(0);
    }),
  );
});
