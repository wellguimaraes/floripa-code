// @effect-diagnostics nodeBuiltinImport:off - Effect's ChildProcess has no IPC channel for passing socket handles.
/**
 * Moves device stream connections off the server's event loop.
 *
 * Every H.264 chunk and every touch used to cross the server's event loop,
 * which it shares with orchestration, provider output, and synchronous SQLite.
 * Any stall there landed directly on interaction latency. After DeviceHubProxy
 * authenticates a stream or socket request, it hands the client's TCP handle
 * to a `t3 device-relay` child, which pipes raw bytes between the client and
 * the hub. WebSocket frames pass through unparsed: the browser and the hub
 * complete the handshake end to end.
 *
 * A connection that is not a plain TCP socket (a web handler in tests, or
 * TLS) is left alone and the in-process proxy serves it.
 */
import * as NodeChildProcess from "node:child_process";
import type * as NodeHttp from "node:http";
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { selfInvocationArgs, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Effect from "effect/Effect";

/** Hop-by-hop, credential, and negotiation headers the hub must not see. */
const RELAY_DROPPED_HEADERS = new Set([
  "host",
  "connection",
  "upgrade",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "content-length",
  "cookie",
  "authorization",
  "dpop",
  "accept-encoding",
  // H.264 and JPEG do not compress; deflate would only cost both ends CPU.
  "sec-websocket-extensions",
]);

/**
 * The request head the hub receives. Plain requests ask the hub to close the
 * connection after its response, so the relay's pipe ends with the stream.
 */
export const relayRequestHead = (input: {
  readonly method: string;
  readonly path: string;
  readonly rawHeaders: ReadonlyArray<string>;
  readonly hubOrigin: string;
  readonly upgrade: boolean;
}) => {
  const hub = new URL(input.hubOrigin);
  const lines = [`${input.method} ${input.path} HTTP/1.1`, `Host: ${hub.host}`];
  for (let index = 0; index + 1 < input.rawHeaders.length; index += 2) {
    const name = input.rawHeaders[index]!;
    const lower = name.toLowerCase();
    if (RELAY_DROPPED_HEADERS.has(lower)) continue;
    // serve-emu refuses mutations whose Origin differs from its own.
    lines.push(`${name}: ${lower === "origin" ? hub.origin : input.rawHeaders[index + 1]}`);
  }
  lines.push(input.upgrade ? "Connection: Upgrade" : "Connection: close");
  if (input.upgrade) lines.push("Upgrade: websocket");
  return `${lines.join("\r\n")}\r\n\r\n`;
};

export interface DeviceSocketRelay {
  /**
   * Sends an authenticated request's connection to the relay. `false` means
   * the connection was not touched and the caller must serve it. After `true`
   * the server no longer owns the socket and should return an empty response,
   * which Node discards.
   */
  readonly handoff: (
    incoming: NodeHttp.IncomingMessage,
    target: {
      readonly hubOrigin: string;
      readonly path: string;
      readonly upgrade: boolean;
      /**
       * Headers that replace the hub's `access-control-*` headers in its
       * response: the relay answers outside the router, so its CORS
       * middleware never sees these responses. WebSockets ignore CORS.
       */
      readonly responseHeaders?: Readonly<Record<string, string>>;
    },
  ) => Effect.Effect<boolean>;
}

/** Starts the relay child (`self` running `device-relay`) on first use and stops it with the scope. */
export const make = Effect.fn("DeviceSocketRelay.make")(function* (self: SelfInvocation) {
  const environment = yield* HostProcess.Environment;
  let child: NodeChildProcess.ChildProcess | null = null;
  // A relay that cannot start must not take device streams down with it.
  let unavailable = false;

  const relayProcess = () => {
    if (child?.connected) return child;
    const spawned = NodeChildProcess.spawn(
      self.command,
      [...selfInvocationArgs(self, ["device-relay"])],
      { env: environment, stdio: ["ignore", "ignore", "inherit", "ipc"], windowsHide: true },
    );
    spawned.on("error", () => {
      unavailable = true;
    });
    spawned.on("exit", () => {
      if (child === spawned) child = null;
    });
    child = spawned;
    return spawned;
  };

  yield* Effect.addFinalizer(() => Effect.sync(() => child?.kill()));

  const handoff: DeviceSocketRelay["handoff"] = (incoming, target) =>
    Effect.callback<boolean>((resume) => {
      const socket: unknown = incoming.socket;
      if (
        unavailable ||
        !(socket instanceof NodeNet.Socket) ||
        socket instanceof NodeTls.TLSSocket ||
        socket.destroyed
      ) {
        resume(Effect.succeed(false));
        return;
      }
      const hub = new URL(target.hubOrigin);
      const message = {
        type: "relay",
        host: hub.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: Number(hub.port || 80),
        head: relayRequestHead({
          method: incoming.method ?? "GET",
          path: target.path,
          rawHeaders: incoming.rawHeaders,
          hubOrigin: target.hubOrigin,
          upgrade: target.upgrade,
        }),
        responseHeaders: Object.entries(target.responseHeaders ?? {})
          .map(([name, value]) => `${name}: ${value}\r\n`)
          .join(""),
      };
      const server: unknown = Reflect.get(socket, "server");
      socket.pause();
      // With `server` set, Node tracks the socket as handed to a cluster
      // worker and `server.close()` would wait for the relay's streams to
      // end. `_server` still settles the connection count on destroy below.
      Reflect.set(socket, "server", null);
      try {
        relayProcess().send(message, socket, () => {
          // Sent or not, the handle has left this socket; close what remains
          // so the HTTP server and the request fiber settle.
          socket.destroy();
          resume(Effect.succeed(true));
        });
      } catch {
        Reflect.set(socket, "server", server);
        socket.resume();
        resume(Effect.succeed(false));
      }
    });

  return { handoff } satisfies DeviceSocketRelay;
});
