// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeURL from "node:url";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";

import * as DeviceSocketRelay from "./DeviceSocketRelay.ts";

const BIN = NodeURL.fileURLToPath(new URL("../bin.ts", import.meta.url));
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Listens on loopback for the test's scope. */
const serve = (server: NodeHttp.Server) =>
  Effect.acquireRelease(
    Effect.callback<number>((resume) => {
      server.listen(0, "127.0.0.1", () =>
        resume(Effect.succeed((server.address() as NodeNet.AddressInfo).port)),
      );
    }),
    () =>
      Effect.callback<void>((resume) => {
        server.closeAllConnections();
        server.close(() => resume(Effect.void));
      }),
  );

/** A hub that streams two chunks and answers one masked WebSocket frame with an echo. */
const startHub = Effect.gen(function* () {
  const seen: Array<{ url: string | undefined; headers: NodeHttp.IncomingHttpHeaders }> = [];
  const hub = NodeHttp.createServer((request, response) => {
    seen.push({ url: request.url, headers: request.headers });
    response.writeHead(200, {
      "content-type": "application/octet-stream",
      "access-control-allow-origin": "http://hub.test",
    });
    response.write("frame-1");
    response.end("frame-2");
  });
  hub.on("upgrade", (request, socket) => {
    seen.push({ url: request.url, headers: request.headers });
    // HTTP servers allow half-open sockets; without this, close waits on it forever.
    socket.on("end", () => socket.destroy());
    const accept = NodeCrypto.createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}${WEBSOCKET_GUID}`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.once("data", (frame: Buffer) => {
      const length = frame[1]! & 0x7f;
      const mask = frame.subarray(2, 6);
      const payload = Buffer.from(frame.subarray(6, 6 + length).map((b, i) => b ^ mask[i % 4]!));
      const reply = Buffer.from(`echo:${payload.toString()}`);
      socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
    });
  });
  const port = yield* serve(hub);
  return { origin: `http://127.0.0.1:${port}`, seen };
});

/** A front server that authenticates nothing and hands every connection to the relay. */
const startFront = (hubOrigin: string) =>
  Effect.gen(function* () {
    const relay = yield* DeviceSocketRelay.make({ command: process.execPath, entrypoint: BIN });
    const run = yield* FiberSet.makeRuntimePromise();
    const front = NodeHttp.createServer((request, response) => {
      void run(
        relay.handoff(request, {
          hubOrigin,
          path: "/helper/sim/stream.avcc",
          upgrade: false,
          responseHeaders: {
            "access-control-allow-origin": "http://app.test",
            "access-control-allow-credentials": "true",
          },
        }),
      ).then((relayed) => {
        if (!relayed) response.end("not relayed");
      });
    });
    front.on("upgrade", (request, socket) => {
      void run(
        relay.handoff(request, { hubOrigin, path: "/helper/ws?device=sim", upgrade: true }),
      ).then((relayed) => {
        if (!relayed) socket.destroy();
      });
    });
    const port = yield* serve(front);
    return { front, port };
  });

const get = (port: number, headers: NodeHttp.OutgoingHttpHeaders) =>
  Effect.callback<{ body: string; headers: NodeHttp.IncomingHttpHeaders }>((resume) => {
    NodeHttp.get({ host: "127.0.0.1", port, path: "/api/device-hub/x", headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => resume(Effect.succeed({ body, headers: response.headers })));
    }).on("error", (error) => resume(Effect.die(error)));
  });

describe("DeviceSocketRelay", () => {
  it.effect("streams the hub's response with the server's CORS headers, not the hub's", () =>
    Effect.gen(function* () {
      const hub = yield* startHub;
      const { port } = yield* startFront(hub.origin);

      const response = yield* get(port, { cookie: "t3_session=secret", origin: "http://app.test" });

      expect(response.body).toBe("frame-1frame-2");
      expect(response.headers["access-control-allow-origin"]).toBe("http://app.test");
      expect(response.headers["access-control-allow-credentials"]).toBe("true");
      expect(hub.seen).toHaveLength(1);
      expect(hub.seen[0]?.url).toBe("/helper/sim/stream.avcc");
      expect(hub.seen[0]?.headers.cookie).toBeUndefined();
      expect(hub.seen[0]?.headers.origin).toBe(hub.origin);
      expect(hub.seen[0]?.headers.connection).toBe("close");
    }).pipe(Effect.scoped),
  );

  it.effect("carries WebSocket frames both ways and does not hold the server open", () =>
    Effect.gen(function* () {
      const hub = yield* startHub;
      const { front, port } = yield* startFront(hub.origin);

      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/device-hub/ws`);
      const reply = yield* Effect.callback<string>((resume) => {
        socket.addEventListener("open", () => socket.send("ping"));
        socket.addEventListener("message", (event) => resume(Effect.succeed(String(event.data))));
        socket.addEventListener("error", () => resume(Effect.die(new Error("socket failed"))));
      });
      expect(reply).toBe("echo:ping");
      expect(hub.seen[0]?.url).toBe("/helper/ws?device=sim");
      expect(hub.seen[0]?.headers["sec-websocket-extensions"]).toBeUndefined();

      // The relayed socket belongs to the child; closing the server must not wait for it.
      yield* Effect.callback<void>((resume) => {
        front.close(() => resume(Effect.void));
      });
      socket.close();
    }).pipe(Effect.scoped),
  );
});
