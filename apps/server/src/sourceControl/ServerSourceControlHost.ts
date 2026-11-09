/**
 * The server's implementation of `SourceControlHost.SourceControlHost`, the only server surface
 * source control provider packages may use.
 *
 * @module sourceControl/ServerSourceControlHost
 */
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SecretResolver from "../secrets/SecretResolver.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

export const layer = Layer.effect(
  SourceControlHost.SourceControlHost,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettings.ServerSettingsService;
    const secretResolver = yield* SecretResolver.SecretResolver;
    const process = yield* VcsProcess.VcsProcess;
    const git = yield* GitVcsDriver.GitVcsDriver;
    const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
    return SourceControlHost.SourceControlHost.of({
      settings: {
        get: serverSettings.getSettings,
        getWithSecrets: serverSettings.getSettings.pipe(
          Effect.flatMap((settings) =>
            SecretResolver.resolveGitHubTokens(secretResolver, settings),
          ),
        ),
      },
      process: { run: process.run },
      git: {
        execute: git.execute,
        resolveCommit: git.resolveCommit,
        remotes: (cwd) =>
          vcsRegistry.resolve({ cwd }).pipe(Effect.map((handle) => handle.driver.listRemotes(cwd))),
        readConfigValue: git.readConfigValue,
        resolvePrimaryRemoteName: git.resolvePrimaryRemoteName,
        ensureRemote: git.ensureRemote,
        listLocalBranchNames: git.listLocalBranchNames,
        fetchRemoteBranch: git.fetchRemoteBranch,
        fetchRemoteTrackingBranch: git.fetchRemoteTrackingBranch,
        setBranchUpstream: git.setBranchUpstream,
        switchRef: git.switchRef,
      },
    });
  }),
).pipe(
  // Layers build once per graph, so every consumer of the resolver shares its read cache.
  Layer.provide(SecretResolver.layer),
);
