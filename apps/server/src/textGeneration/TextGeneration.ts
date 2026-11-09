import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  isProviderAvailable,
  isProviderTextGenerationCapable,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { isModelSelectionProviderEnabled } from "@t3tools/shared/serverSettings";
import { exhaustedUsageWindow } from "@t3tools/shared/usageLimits";
import * as ServerSettings from "../serverSettings.ts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import { TextGenerationError } from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";

export type {
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ThreadTitleDriftInput,
  ThreadTitleDriftResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "detectThreadTitleDrift";

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

/**
 * Text generation runs on `selection` unless its provider is out of usage and the configured
 * fallback model's provider can take the work instead.
 */
const resolveFallbackSelection = Effect.fn("TextGeneration.resolveFallbackSelection")(function* (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  serverSettings: ServerSettings.ServerSettingsService["Service"],
  operation: TextGenerationOp,
  selection: ModelSelection,
) {
  const settings = yield* serverSettings.getSettings.pipe(
    Effect.mapError(
      (cause) =>
        new TextGenerationError({
          operation,
          detail: "Could not read fallback model settings.",
          cause,
        }),
    ),
  );
  const fallback = settings.fallbackModelSelection;
  if (!fallback || fallback.instanceId === selection.instanceId) return selection;
  const instances = yield* registry.listInstances;
  const snapshots = yield* Effect.forEach(instances, (instance) => instance.snapshot.getSnapshot);
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  const current = snapshots.find((provider) => provider.instanceId === selection.instanceId);
  if (!exhaustedUsageWindow(current, now, selection.model)) return selection;
  const target = snapshots.find((provider) => provider.instanceId === fallback.instanceId);
  const driver = target?.driver;
  const model =
    (driver &&
      (DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[driver] ?? DEFAULT_MODEL_BY_PROVIDER[driver])) ||
    DEFAULT_TEXT_GENERATION_MODEL;
  return target?.enabled === true &&
    target.installed &&
    target.auth.status !== "unauthenticated" &&
    isProviderAvailable(target) &&
    isProviderTextGenerationCapable(target) &&
    isModelSelectionProviderEnabled(settings, fallback) &&
    !exhaustedUsageWindow(target, now, model)
    ? { instanceId: fallback.instanceId, model }
    : selection;
});

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const generate = <A>(
    operation: TextGenerationOp,
    selection: ModelSelection,
    invoke: (
      service: ProviderInstance["textGeneration"],
      modelSelection: ModelSelection,
    ) => Effect.Effect<A, TextGenerationError>,
  ) =>
    resolveFallbackSelection(registry, serverSettings, operation, selection).pipe(
      Effect.flatMap((resolved) =>
        resolveInstance(registry, operation, resolved.instanceId).pipe(
          Effect.flatMap((service) => invoke(service, resolved)),
        ),
      ),
    );
  return TextGeneration.of({
    generateCommitMessage: (input) =>
      generate("generateCommitMessage", input.modelSelection, (service, modelSelection) =>
        service.generateCommitMessage({ ...input, modelSelection }),
      ),
    generatePrContent: (input) =>
      generate("generatePrContent", input.modelSelection, (service, modelSelection) =>
        service.generatePrContent({ ...input, modelSelection }),
      ),
    generateBranchName: (input) =>
      generate("generateBranchName", input.modelSelection, (service, modelSelection) =>
        service.generateBranchName({ ...input, modelSelection }),
      ),
    generateThreadTitle: (input) =>
      generate("generateThreadTitle", input.modelSelection, (textGeneration, modelSelection) =>
        Effect.gen(function* () {
          const linkedContext =
            input.linkedContext ??
            (yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
              Effect.provideService(
                SourceControlProviderRegistry.SourceControlProviderRegistry,
                sourceControl,
              ),
            ));
          return yield* textGeneration.generateThreadTitle({
            ...input,
            linkedContext,
            modelSelection,
          });
        }),
      ),
    detectThreadTitleDrift: (input) =>
      generate("detectThreadTitleDrift", input.modelSelection, (service, modelSelection) =>
        service.detectThreadTitleDrift({ ...input, modelSelection }),
      ),
  });
});

export const layer = Layer.effect(TextGeneration, make);
