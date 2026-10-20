// @effect-diagnostics nodeBuiltinImport:off
/**
 * `t3 device-relay`: the process that carries device stream bytes.
 *
 * The server authenticates each device stream and socket request, then sends
 * the client's TCP handle here with the request head already rewritten for the
 * hub. From then on this process pipes raw bytes both ways, so video frames
 * and touches never wait on the server's event loop. See DeviceSocketRelay.
 */
import * as NodeNet from "node:net";

interface RelayMessage {
  readonly type: "relay";
  readonly host: string;
  readonly port: number;
  readonly head: string;
  /** Header lines, each ending in CRLF, that replace the hub's CORS headers. */
  readonly responseHeaders: string;
}

const isRelayMessage = (message: unknown): message is RelayMessage =>
  typeof message === "object" &&
  message !== null &&
  "type" in message &&
  message.type === "relay" &&
  "host" in message &&
  typeof message.host === "string" &&
  "port" in message &&
  typeof message.port === "number" &&
  "head" in message &&
  typeof message.head === "string" &&
  "responseHeaders" in message &&
  typeof message.responseHeaders === "string";

/** Hub response heads are small; anything larger is not a response worth relaying. */
const MAX_RESPONSE_HEAD_BYTES = 64 * 1024;
const CORS_HEADER_LINE = /^access-control-/i;

const relay = (client: NodeNet.Socket, message: RelayMessage) => {
  const upstream = NodeNet.connect({ host: message.host, port: message.port });
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close).on("close", close);
  upstream.on("error", close).on("close", close);
  client.setNoDelay(true);
  upstream.setNoDelay(true);
  upstream.write(message.head);
  client.pipe(upstream);
  if (message.responseHeaders === "") {
    upstream.pipe(client);
    return;
  }
  // Rewrite the response head once, then hand the rest of the stream to pipe.
  let pending = Buffer.alloc(0);
  const readHead = (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    const end = pending.indexOf("\r\n\r\n");
    if (end === -1) {
      if (pending.length > MAX_RESPONSE_HEAD_BYTES) close();
      return;
    }
    upstream.off("data", readHead);
    upstream.pause();
    const lines = pending
      .subarray(0, end)
      .toString("latin1")
      .split("\r\n")
      .filter((line, index) => index === 0 || !CORS_HEADER_LINE.test(line));
    client.write(`${lines.join("\r\n")}\r\n${message.responseHeaders}\r\n`);
    client.write(pending.subarray(end + 4));
    upstream.pipe(client);
  };
  upstream.on("data", readHead);
};

export function runDeviceRelay(): void {
  process.on("message", (message: unknown, handle: unknown) => {
    if (!(handle instanceof NodeNet.Socket)) return;
    if (!isRelayMessage(message)) {
      handle.destroy();
      return;
    }
    relay(handle, message);
  });
  // The server owns this process; without it there is nothing left to serve.
  process.on("disconnect", () => process.exit(0));
}
