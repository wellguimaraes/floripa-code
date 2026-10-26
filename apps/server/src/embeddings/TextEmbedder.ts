// Effect's Crypto digests whole buffers; downloads are hashed as they stream.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeURL from "node:url";
import * as NodeWorkerThreads from "node:worker_threads";

import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as RcRef from "effect/RcRef";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../config.ts";

/**
 * Turns text into unit vectors with multilingual-e5-small, so similar meaning
 * across languages lands close together. Nothing ships with the app: the
 * first call downloads pinned, hash-checked files (~150MB) into T3 home.
 *
 * The ONNX runtime runs as WebAssembly in a worker thread. WASM keeps native
 * binaries out of the bundle and the desktop and executable builds, and the
 * worker keeps inference (hundreds of milliseconds for a long passage) off
 * the event loop. A loaded worker holds about 1GB, so it shuts down after a
 * minute without requests.
 */

const ORT_BASE_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist";
const TOKENIZERS_BASE_URL = "https://cdn.jsdelivr.net/npm/@huggingface/tokenizers@0.2.0/dist";
const MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const MODEL_BASE_URL = `https://huggingface.co/Xenova/multilingual-e5-small/resolve/${MODEL_REVISION}`;

/** Identifies the vector space; changing the model or how tokens are pooled must change it. */
export const TEXT_EMBEDDING_MODEL_ID = `multilingual-e5-small@${MODEL_REVISION.slice(0, 7)}`;

const ASSETS = {
  runtime: {
    file: "ort.wasm.bundle.min.mjs",
    url: `${ORT_BASE_URL}/ort.wasm.bundle.min.mjs`,
    sha256: "cace3b98bee45c1c40ed04e07b984fb66012acacb702e6aecd9008239bf35e99",
  },
  wasmGlue: {
    file: "ort-wasm-simd-threaded.mjs",
    url: `${ORT_BASE_URL}/ort-wasm-simd-threaded.mjs`,
    sha256: "90a557d15c02bac4504d95b67f431d8594635ed2a0a62a7f2cd83d090ff91d3e",
  },
  wasm: {
    file: "ort-wasm-simd-threaded.wasm",
    url: `${ORT_BASE_URL}/ort-wasm-simd-threaded.wasm`,
    sha256: "45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15",
  },
  tokenizers: {
    file: "tokenizers.min.mjs",
    url: `${TOKENIZERS_BASE_URL}/tokenizers.min.mjs`,
    sha256: "258e46332101335ce8d95aed7745b19ac3b46d37f3e159a89cf894c2ea9b1d3a",
  },
  model: {
    file: "model_quantized.onnx",
    url: `${MODEL_BASE_URL}/onnx/model_quantized.onnx`,
    sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
  },
  tokenizer: {
    file: "tokenizer.json",
    url: `${MODEL_BASE_URL}/tokenizer.json`,
    sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
  },
  tokenizerConfig: {
    file: "tokenizer_config.json",
    url: `${MODEL_BASE_URL}/tokenizer_config.json`,
    sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
  },
} as const;

type AssetKey = keyof typeof ASSETS;

// Passages longer than this cost more than they add: e5 reads at most 512
// tokens, and inference time grows faster than linearly past ~256.
const MAX_TOKENS = 256;
const IDLE_TIME_TO_LIVE = Duration.minutes(1);

// Runs as CommonJS through `eval`, so it can live in this bundle; it loads
// the runtime and tokenizer it needs from the downloaded files.
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const fs = require("node:fs");
(async () => {
  const ort = await import(workerData.runtimeUrl);
  const { Tokenizer } = await import(workerData.tokenizersUrl);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { mjs: workerData.wasmGlueUrl, wasm: workerData.wasmUrl };
  ort.env.logLevel = "error";
  const tokenizer = new Tokenizer(
    JSON.parse(fs.readFileSync(workerData.tokenizerPath, "utf8")),
    JSON.parse(fs.readFileSync(workerData.tokenizerConfigPath, "utf8")),
  );
  const session = await ort.InferenceSession.create(fs.readFileSync(workerData.modelPath));
  const int64 = (values, length) => new ort.Tensor("int64", values, [1, length]);
  parentPort.on("message", async ({ id, texts }) => {
    try {
      const vectors = [];
      for (const text of texts) {
        const ids = tokenizer.encode(text).ids.slice(0, workerData.maxTokens);
        const length = ids.length;
        const feeds = {
          input_ids: int64(BigInt64Array.from(ids, BigInt), length),
          attention_mask: int64(new BigInt64Array(length).fill(1n), length),
        };
        if (session.inputNames.includes("token_type_ids")) {
          feeds.token_type_ids = int64(new BigInt64Array(length), length);
        }
        const output = (await session.run(feeds)).last_hidden_state;
        const width = output.dims[2];
        const vector = new Float32Array(width);
        for (let token = 0; token < length; token++) {
          for (let k = 0; k < width; k++) vector[k] += output.data[token * width + k];
        }
        let norm = 0;
        for (let k = 0; k < width; k++) norm += vector[k] * vector[k];
        norm = Math.sqrt(norm) || 1;
        for (let k = 0; k < width; k++) vector[k] /= norm;
        vectors.push(vector);
      }
      parentPort.postMessage({ id, vectors }, vectors.map((vector) => vector.buffer));
    } catch (error) {
      parentPort.postMessage({ id, error: String((error && error.message) || error) });
    }
  });
  parentPort.postMessage({ ready: true });
})().catch((error) => {
  parentPort.postMessage({ fatal: String((error && error.message) || error) });
});
`;

/** Carries no text: what gets embedded is user content. */
export class TextEmbedderError extends Schema.TaggedError<TextEmbedderError>()(
  "TextEmbedderError",
  {
    stage: Schema.Literals(["download", "verify", "load", "embed"]),
    asset: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.asset === undefined
      ? `Text embedding ${this.stage} failed.`
      : `Text embedding ${this.stage} failed for ${this.asset}.`;
  }
}

/** The role e5 was trained with: queries and passages are embedded differently. */
type TextEmbeddingRole = "query" | "passage";

export class TextEmbedder extends Context.Service<
  TextEmbedder,
  {
    /** Unit vectors, one per text, in order. */
    readonly embed: (
      role: TextEmbeddingRole,
      texts: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<Float32Array>, TextEmbedderError>;
  }
>()("t3/embeddings/TextEmbedder") {}

interface EmbedWorker {
  readonly run: (
    texts: ReadonlyArray<string>,
  ) => Effect.Effect<ReadonlyArray<Float32Array>, TextEmbedderError>;
}

type WorkerReply =
  | { readonly ready: true }
  | { readonly fatal: string }
  | { readonly id: number; readonly vectors: ReadonlyArray<Float32Array> }
  | { readonly id: number; readonly error: string };

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const config = yield* ServerConfig.ServerConfig;
  const assetDir = path.join(config.baseDir, "caches", "embeddings", TEXT_EMBEDDING_MODEL_ID);
  const assetPath = (key: AssetKey) => path.join(assetDir, ASSETS[key].file);
  // Concurrent first calls share one download.
  const downloadLock = yield* Semaphore.make(1);

  const download = (key: AssetKey) =>
    Effect.gen(function* () {
      const asset = ASSETS[key];
      const target = assetPath(key);
      const present = yield* fileSystem
        .exists(target)
        .pipe(
          Effect.mapError(
            (cause) => new TextEmbedderError({ stage: "download", asset: asset.file, cause }),
          ),
        );
      if (present) return;
      const partial = `${target}.partial`;
      const hash = NodeCrypto.createHash("sha256");
      yield* HttpClientResponse.stream(client.get(asset.url)).pipe(
        Stream.tap((chunk) => Effect.sync(() => hash.update(chunk))),
        Stream.run(fileSystem.sink(partial)),
        Effect.mapError(
          (cause) => new TextEmbedderError({ stage: "download", asset: asset.file, cause }),
        ),
      );
      const digest = hash.digest("hex");
      if (digest !== asset.sha256) {
        yield* fileSystem.remove(partial).pipe(Effect.ignore);
        return yield* new TextEmbedderError({
          stage: "verify",
          asset: asset.file,
          cause: new Error("Downloaded file does not match its pinned hash."),
        });
      }
      yield* fileSystem
        .rename(partial, target)
        .pipe(
          Effect.mapError(
            (cause) => new TextEmbedderError({ stage: "download", asset: asset.file, cause }),
          ),
        );
    });

  const ensureAssets = downloadLock.withPermits(1)(
    Effect.gen(function* () {
      yield* fileSystem
        .makeDirectory(assetDir, { recursive: true })
        .pipe(Effect.mapError((cause) => new TextEmbedderError({ stage: "download", cause })));
      for (const key of Object.keys(ASSETS) as AssetKey[]) {
        yield* download(key);
      }
    }),
  );

  const startWorker = Effect.gen(function* () {
    yield* ensureAssets;
    const worker = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new NodeWorkerThreads.Worker(WORKER_SOURCE, {
            eval: true,
            // ORT's WASM build prints CPU-detection warnings; failures arrive
            // as messages instead.
            stderr: true,
            workerData: {
              runtimeUrl: NodeURL.pathToFileURL(assetPath("runtime")).href,
              tokenizersUrl: NodeURL.pathToFileURL(assetPath("tokenizers")).href,
              wasmGlueUrl: NodeURL.pathToFileURL(assetPath("wasmGlue")).href,
              wasmUrl: NodeURL.pathToFileURL(assetPath("wasm")).href,
              modelPath: assetPath("model"),
              tokenizerPath: assetPath("tokenizer"),
              tokenizerConfigPath: assetPath("tokenizerConfig"),
              maxTokens: MAX_TOKENS,
            },
          }),
      ),
      (worker) => Effect.promise(() => worker.terminate()),
    );

    worker.stderr.resume();
    const ready = yield* Deferred.make<void, TextEmbedderError>();
    const pending = new Map<
      number,
      Deferred.Deferred<ReadonlyArray<Float32Array>, TextEmbedderError>
    >();
    let nextId = 0;
    let exited: TextEmbedderError | null = null;
    const failAll = (cause: unknown) => {
      const error = new TextEmbedderError({ stage: "load", cause });
      Deferred.doneUnsafe(ready, Effect.fail(error));
      for (const deferred of pending.values()) Deferred.doneUnsafe(deferred, Effect.fail(error));
      pending.clear();
      exited ??= error;
    };
    worker.on("message", (reply: WorkerReply) => {
      if ("ready" in reply) return Deferred.doneUnsafe(ready, Effect.void);
      if ("fatal" in reply) return failAll(new Error(reply.fatal));
      const deferred = pending.get(reply.id);
      if (deferred === undefined) return;
      pending.delete(reply.id);
      Deferred.doneUnsafe(
        deferred,
        "error" in reply
          ? Effect.fail(new TextEmbedderError({ stage: "embed", cause: new Error(reply.error) }))
          : Effect.succeed(reply.vectors),
      );
    });
    worker.on("error", failAll);
    worker.on("exit", (code) => failAll(new Error(`Embedding worker exited with code ${code}.`)));
    yield* Deferred.await(ready);

    return {
      run: (texts) =>
        Effect.suspend(() => {
          if (exited !== null) return Effect.fail(exited);
          const id = nextId++;
          const deferred = Deferred.makeUnsafe<ReadonlyArray<Float32Array>, TextEmbedderError>();
          pending.set(id, deferred);
          // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Node worker port
          worker.postMessage({ id, texts });
          return Deferred.await(deferred);
        }),
    } satisfies EmbedWorker;
  });

  const workerRef = yield* RcRef.make({ acquire: startWorker, idleTimeToLive: IDLE_TIME_TO_LIVE });

  const embed: TextEmbedder["Service"]["embed"] = (role, texts) =>
    texts.length === 0
      ? Effect.succeed([])
      : RcRef.get(workerRef).pipe(
          Effect.flatMap((worker) => worker.run(texts.map((text) => `${role}: ${text}`))),
          // A crashed worker must not stay cached for the next call.
          Effect.tapError(() => RcRef.invalidate(workerRef)),
          Effect.scoped,
          Effect.withSpan("TextEmbedder.embed", { attributes: { role, count: texts.length } }),
        );

  return TextEmbedder.of({ embed });
});

export const layer = Layer.effect(TextEmbedder, make);
