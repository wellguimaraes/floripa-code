import { assert, it } from "@effect/vitest";
import type * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import * as LspConnection from "./LspConnection.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
const frame = (message: object) => LspConnection.encodeLspMessage(message);

/**
 * The server end of an in-memory connection: `received` yields what the client
 * wrote, `send` writes to the client, `end` closes the server's output.
 */
const makePeer = Effect.gen(function* () {
  const stdout = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const received = yield* Queue.unbounded<Record<string, unknown>>();
  const decode = LspConnection.makeLspFrameDecoder();
  const stdin = Sink.forEach((chunk: Uint8Array) =>
    decode(chunk).pipe(
      Effect.orDie,
      Effect.flatMap((messages) =>
        Queue.offerAll(received, messages as ReadonlyArray<Record<string, unknown>>),
      ),
    ),
  );
  return {
    io: { stdin, stdout: Stream.fromQueue(stdout) },
    received,
    send: (message: object) => Queue.offer(stdout, frame(message)),
    end: Queue.end(stdout),
  };
});

it.effect("decodes frames split across chunks and several frames in one chunk", () =>
  Effect.gen(function* () {
    const decode = LspConnection.makeLspFrameDecoder();
    // The length counts bytes, so a multi-byte character must not shift the split.
    const first = frame({ id: 1, result: "héllo ✓" });
    const second = frame({ method: "window/logMessage" });
    const all = new Uint8Array([...first, ...second]);

    assert.deepStrictEqual(yield* decode(all.subarray(0, 5)), []);
    assert.deepStrictEqual(yield* decode(all.subarray(5, first.length - 2)), []);
    assert.deepStrictEqual(yield* decode(all.subarray(first.length - 2)), [
      { id: 1, result: "héllo ✓" },
      { method: "window/logMessage" },
    ]);
  }),
);

it.effect("accepts extra headers in any case", () =>
  Effect.gen(function* () {
    const decode = LspConnection.makeLspFrameDecoder();
    const body = JSON.stringify({ id: 7, result: null });
    const messages = yield* decode(
      bytes(
        `content-type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${body.length}\r\n\r\n${body}`,
      ),
    );
    assert.deepStrictEqual(messages, [{ id: 7, result: null }]);
  }),
);

it.effect("rejects a header without a length and a body that is not JSON", () =>
  Effect.gen(function* () {
    const missing = yield* LspConnection.makeLspFrameDecoder()(bytes("X-Other: 1\r\n\r\n{}")).pipe(
      Effect.flip,
    );
    assert.strictEqual(missing.reason, "missing-content-length");
    const invalid = yield* LspConnection.makeLspFrameDecoder()(
      bytes("Content-Length: 3\r\n\r\n{x}"),
    ).pipe(Effect.flip);
    assert.strictEqual(invalid.reason, "invalid-json");
  }),
);

it.effect("matches responses to requests by id, in any order", () =>
  Effect.gen(function* () {
    const peer = yield* makePeer;
    const connection = yield* LspConnection.make(peer.io);

    const hover = yield* connection
      .request("textDocument/hover", { n: 1 }, { timeout: "1 minute" })
      .pipe(Effect.forkChild);
    const definition = yield* connection
      .request("textDocument/definition", { n: 2 }, { timeout: "1 minute" })
      .pipe(Effect.forkChild);
    const first = yield* Queue.take(peer.received);
    const second = yield* Queue.take(peer.received);
    assert.strictEqual(first.method, "textDocument/hover");
    assert.strictEqual(second.method, "textDocument/definition");

    yield* peer.send({ jsonrpc: "2.0", id: second.id, result: "definition" });
    yield* peer.send({ jsonrpc: "2.0", id: first.id, result: "hover" });
    assert.strictEqual(yield* Fiber.join(definition), "definition");
    assert.strictEqual(yield* Fiber.join(hover), "hover");
  }),
);

it.effect("fails a request the server answers with an error", () =>
  Effect.gen(function* () {
    const peer = yield* makePeer;
    const connection = yield* LspConnection.make(peer.io);
    const pending = yield* connection
      .request("textDocument/hover", {}, { timeout: "1 minute" })
      .pipe(Effect.asVoid, Effect.flip, Effect.forkChild);
    const request = yield* Queue.take(peer.received);
    yield* peer.send({ jsonrpc: "2.0", id: request.id, error: { code: -32603, message: "boom" } });

    const error = yield* Fiber.join(pending);
    assert.strictEqual(error._tag, "LspResponseError");
    assert.deepStrictEqual(error._tag === "LspResponseError" ? [error.method, error.code] : [], [
      "textDocument/hover",
      -32603,
    ]);
  }),
);

it.effect("answers the server's own requests so it never waits on the client", () =>
  Effect.gen(function* () {
    const peer = yield* makePeer;
    yield* LspConnection.make(peer.io);

    yield* peer.send({ jsonrpc: "2.0", id: 1, method: "client/registerCapability", params: {} });
    yield* peer.send({
      jsonrpc: "2.0",
      id: 2,
      method: "workspace/configuration",
      params: { items: [{ section: "a" }, { section: "b" }] },
    });
    yield* peer.send({ jsonrpc: "2.0", id: 3, method: "workspace/applyEdit", params: {} });

    const answers = new Map<unknown, Record<string, unknown>>();
    for (let index = 0; index < 3; index += 1) {
      const answer = yield* Queue.take(peer.received);
      answers.set(answer.id, answer);
    }
    assert.deepStrictEqual(answers.get(1), { jsonrpc: "2.0", id: 1, result: null });
    assert.deepStrictEqual(answers.get(2), { jsonrpc: "2.0", id: 2, result: [null, null] });
    assert.strictEqual((answers.get(3)?.error as { code: number } | undefined)?.code, -32601);
  }),
);

it.effect("fails pending and later requests once the server's output ends", () =>
  Effect.gen(function* () {
    const peer = yield* makePeer;
    const connection = yield* LspConnection.make(peer.io);
    const pending = yield* connection
      .request("textDocument/hover", {}, { timeout: "1 minute" })
      .pipe(Effect.asVoid, Effect.flip, Effect.forkChild);
    yield* Queue.take(peer.received);

    yield* peer.end;

    assert.strictEqual((yield* Fiber.join(pending))._tag, "LspConnectionClosedError");
    assert.strictEqual((yield* connection.closed)._tag, "LspConnectionClosedError");
    const later = yield* connection
      .request("textDocument/hover", {}, { timeout: "1 minute" })
      .pipe(Effect.asVoid, Effect.flip);
    assert.strictEqual(later._tag, "LspConnectionClosedError");
  }),
);

it.effect("cancels a request on the server when the caller gives up", () =>
  Effect.gen(function* () {
    const peer = yield* makePeer;
    const connection = yield* LspConnection.make(peer.io);
    const pending = yield* connection
      .request("textDocument/hover", {}, { timeout: "1 minute" })
      .pipe(Effect.forkChild);
    const request = yield* Queue.take(peer.received);

    yield* Fiber.interrupt(pending);

    assert.deepStrictEqual(yield* Queue.take(peer.received), {
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: request.id },
    });
    // A late answer for the cancelled id is dropped, and the connection keeps working.
    yield* peer.send({ jsonrpc: "2.0", id: request.id, result: "late" });
    const next = yield* connection
      .request("textDocument/hover", {}, { timeout: "1 minute" })
      .pipe(Effect.forkChild);
    const nextRequest = yield* Queue.take(peer.received);
    yield* peer.send({ jsonrpc: "2.0", id: nextRequest.id, result: "fresh" });
    assert.strictEqual(yield* Fiber.join(next), "fresh");
  }),
);

it.effect("times out and cancels a request the server never answers", () =>
  Effect.gen(function* () {
    const peer = yield* makePeer;
    const connection = yield* LspConnection.make(peer.io);
    const error = yield* connection
      .request("textDocument/definition", {}, { timeout: 0 })
      .pipe(Effect.asVoid, Effect.flip);

    assert.strictEqual(error._tag, "LspRequestTimeoutError");
    const request = yield* Queue.take(peer.received);
    assert.deepStrictEqual(yield* Queue.take(peer.received), {
      jsonrpc: "2.0",
      method: "$/cancelRequest",
      params: { id: request.id },
    });
  }),
);
