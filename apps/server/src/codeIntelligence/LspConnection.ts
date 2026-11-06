/**
 * LspConnection - JSON-RPC 2.0 over a language server's stdio, framed with
 * LSP's `Content-Length` headers.
 *
 * Responses are matched to requests by id. The few requests a server sends to
 * the client get a minimal answer so it never waits on us. When the server's
 * output ends, every pending and later request fails with
 * `LspConnectionClosedError`.
 *
 * @module LspConnection
 */
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

const HEADER_SEPARATOR = "\r\n\r\n";
/** A header block this long without a separator means the stream is not LSP. */
const MAX_HEADER_BYTES = 8 * 1024;
const CONTENT_LENGTH_PATTERN = /^content-length:\s*(\d+)\s*$/im;
const METHOD_NOT_FOUND = -32601;
const decodeJsonBody = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export class LspProtocolError extends Schema.TaggedError<LspProtocolError>()("LspProtocolError", {
  reason: Schema.Literals(["missing-content-length", "header-too-large", "invalid-json"]),
}) {
  override get message(): string {
    return `Language server sent a malformed message (${this.reason}).`;
  }
}

export class LspConnectionClosedError extends Schema.TaggedError<LspConnectionClosedError>()(
  "LspConnectionClosedError",
  { cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return "Language server connection closed.";
  }
}

export class LspResponseError extends Schema.TaggedError<LspResponseError>()("LspResponseError", {
  method: Schema.String,
  code: Schema.Number,
  /** The server's error object; its message is server text, so it stays here. */
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Language server answered '${this.method}' with error ${this.code}.`;
  }
}

export class LspRequestTimeoutError extends Schema.TaggedError<LspRequestTimeoutError>()(
  "LspRequestTimeoutError",
  { method: Schema.String, timeoutMs: Schema.Number },
) {
  override get message(): string {
    return `Language server did not answer '${this.method}' within ${this.timeoutMs}ms.`;
  }
}

export type LspRequestError = LspConnectionClosedError | LspResponseError | LspRequestTimeoutError;

/** Encodes one JSON-RPC message with its `Content-Length` header. */
export function encodeLspMessage(message: object): Uint8Array {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}${HEADER_SEPARATOR}`), body]);
}

/**
 * Splits a byte stream into JSON-RPC messages. Chunks may end anywhere,
 * including inside a header or a multi-byte character; the length counts bytes.
 */
export function makeLspFrameDecoder() {
  let buffer = Buffer.alloc(0);
  return (chunk: Uint8Array): Effect.Effect<ReadonlyArray<unknown>, LspProtocolError> =>
    Effect.suspend(() => {
      buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
      const messages: unknown[] = [];
      while (true) {
        const headerEnd = buffer.indexOf(HEADER_SEPARATOR);
        if (headerEnd < 0) {
          if (buffer.length > MAX_HEADER_BYTES) {
            return Effect.fail(new LspProtocolError({ reason: "header-too-large" }));
          }
          return Effect.succeed(messages);
        }
        const match = CONTENT_LENGTH_PATTERN.exec(buffer.toString("ascii", 0, headerEnd));
        if (!match) return Effect.fail(new LspProtocolError({ reason: "missing-content-length" }));
        const bodyStart = headerEnd + HEADER_SEPARATOR.length;
        const bodyEnd = bodyStart + Number(match[1]);
        if (buffer.length < bodyEnd) return Effect.succeed(messages);
        const body = decodeJsonBody(buffer.toString("utf8", bodyStart, bodyEnd));
        buffer = buffer.subarray(bodyEnd);
        if (Option.isNone(body))
          return Effect.fail(new LspProtocolError({ reason: "invalid-json" }));
        messages.push(body.value);
      }
    });
}

type JsonRpcMessage = {
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown };
};

const isRecord = (value: unknown): value is JsonRpcMessage =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The answer to a request the server sends us. We register no watchers and
 * hold no settings, so acknowledging is enough; anything else is unsupported.
 */
function answerServerRequest(method: string, params: unknown) {
  switch (method) {
    case "client/registerCapability":
    case "client/unregisterCapability":
    case "window/workDoneProgress/create":
      return { result: null };
    case "workspace/configuration": {
      const items =
        isRecord(params) && Array.isArray((params as { items?: unknown }).items)
          ? (params as { items: ReadonlyArray<unknown> }).items
          : [];
      return { result: items.map(() => null) };
    }
    default:
      return { error: { code: METHOD_NOT_FOUND, message: `Unsupported method: ${method}` } };
  }
}

export interface LspConnection {
  readonly request: (
    method: string,
    params: unknown,
    options: { readonly timeout: Duration.Input },
  ) => Effect.Effect<unknown, LspRequestError>;
  readonly notify: (
    method: string,
    params: unknown,
  ) => Effect.Effect<void, LspConnectionClosedError>;
  /** Succeeds with the reason once the server's output has ended. */
  readonly closed: Effect.Effect<LspConnectionClosedError>;
}

/**
 * Starts reading the server's output in the surrounding scope. Closing the
 * scope stops the reader; the process itself belongs to the caller.
 */
export const make = Effect.fn("LspConnection.make")(function* <EIn, EOut>(io: {
  readonly stdin: Sink.Sink<void, Uint8Array, never, EIn>;
  readonly stdout: Stream.Stream<Uint8Array, EOut>;
}) {
  const scope = yield* Effect.scope;
  const writeLock = yield* Semaphore.make(1);
  const pending = new Map<
    number,
    {
      readonly method: string;
      readonly deferred: Deferred.Deferred<unknown, LspResponseError | LspConnectionClosedError>;
    }
  >();
  const closedSignal = yield* Deferred.make<LspConnectionClosedError>();
  let closedError: LspConnectionClosedError | undefined;
  let nextId = 1;

  const write = (message: object) =>
    closedError !== undefined
      ? Effect.fail(closedError)
      : writeLock
          .withPermits(1)(Stream.run(Stream.make(encodeLspMessage(message)), io.stdin))
          .pipe(Effect.mapError((cause) => new LspConnectionClosedError({ cause })));

  const notify: LspConnection["notify"] = (method, params) =>
    write({ jsonrpc: "2.0", method, params });

  const close = (error: LspConnectionClosedError) =>
    Effect.suspend(() => {
      if (closedError !== undefined) return Effect.void;
      closedError = error;
      const waiting = [...pending.values()];
      pending.clear();
      return Effect.forEach(waiting, ({ deferred }) => Deferred.fail(deferred, error), {
        discard: true,
      }).pipe(Effect.andThen(Deferred.succeed(closedSignal, error)));
    });

  const dispatch = (message: unknown): Effect.Effect<void> => {
    if (!isRecord(message)) return Effect.void;
    const { id, method } = message;
    if (method === undefined) {
      if (typeof id !== "number") return Effect.void;
      const entry = pending.get(id);
      if (entry === undefined) return Effect.void;
      pending.delete(id);
      if (message.error !== undefined) {
        const code = typeof message.error?.code === "number" ? message.error.code : 0;
        return Deferred.fail(
          entry.deferred,
          new LspResponseError({ method: entry.method, code, cause: message.error }),
        ).pipe(Effect.asVoid);
      }
      return Deferred.succeed(entry.deferred, message.result ?? null).pipe(Effect.asVoid);
    }
    if (id === undefined) return Effect.void; // A notification: logs, progress, diagnostics.
    // Answered off the reader so a full stdin can never stall draining stdout.
    return write({ jsonrpc: "2.0", id, ...answerServerRequest(method, message.params) }).pipe(
      Effect.ignore,
      Effect.forkIn(scope),
      Effect.asVoid,
    );
  };

  const decode = makeLspFrameDecoder();
  yield* io.stdout.pipe(
    Stream.runForEach((chunk) =>
      decode(chunk).pipe(Effect.flatMap((messages) => Effect.forEach(messages, dispatch))),
    ),
    Effect.exit,
    Effect.flatMap((exit) =>
      close(new LspConnectionClosedError(exit._tag === "Failure" ? { cause: exit.cause } : {})),
    ),
    Effect.forkIn(scope),
  );

  const cancel = (id: number) =>
    Effect.suspend(() =>
      pending.delete(id) ? notify("$/cancelRequest", { id }).pipe(Effect.ignore) : Effect.void,
    );

  const request: LspConnection["request"] = (method, params, options) =>
    Effect.suspend(() => {
      if (closedError !== undefined) return Effect.fail(closedError);
      const id = nextId++;
      const deferred = Deferred.makeUnsafe<unknown, LspResponseError | LspConnectionClosedError>();
      pending.set(id, { method, deferred });
      return write({ jsonrpc: "2.0", id, method, params }).pipe(
        Effect.andThen(Deferred.await(deferred)),
        Effect.timeoutOption(options.timeout),
        Effect.flatMap(
          Option.match({
            onSome: Effect.succeed,
            onNone: () =>
              cancel(id).pipe(
                Effect.andThen(
                  Effect.fail(
                    new LspRequestTimeoutError({
                      method,
                      timeoutMs: Duration.toMillis(options.timeout),
                    }),
                  ),
                ),
              ),
          }),
        ),
        Effect.onInterrupt(() => cancel(id)),
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      );
    });

  return { request, notify, closed: Deferred.await(closedSignal) } satisfies LspConnection;
});
