import { describe, expect, it } from "vite-plus/test";
import { HttpRouter, HttpServerResponse } from "effect/http";
import * as Layer from "effect/Layer";

import { browserApiCorsAllowedMethods, browserApiCorsResponseHeaders } from "./httpCors.ts";

const CORS_HEADERS = ["access-control-allow-origin", "access-control-allow-credentials", "vary"];

/** What the router's own CORS middleware puts on a GET response. */
const routerHeaders = async (
  options: Parameters<typeof browserApiCorsResponseHeaders>[0],
  origin: string | undefined,
) => {
  const { handler, dispose } = HttpRouter.toWebHandler(
    Layer.mergeAll(
      HttpRouter.add("GET", "/stream", HttpServerResponse.empty()),
      HttpRouter.cors({ ...options, allowedMethods: browserApiCorsAllowedMethods }),
    ),
    { disableLogger: true },
  );
  try {
    const response = await handler(
      new Request("http://t3.test/stream", origin ? { headers: { origin } } : {}),
    );
    return Object.fromEntries(
      CORS_HEADERS.flatMap((name) => {
        const value = response.headers.get(name);
        return value === null ? [] : [[name, value]];
      }),
    );
  } finally {
    await dispose();
  }
};

describe("browserApiCorsResponseHeaders", () => {
  const dev = {
    allowedOrigins: ["http://localhost:5733", "floripacode-dev://app"],
    credentials: true,
  };
  it.each([
    ["packaged, any origin", {}, "https://app.t3.codes"],
    ["dev, allowed origin", dev, "floripacode-dev://app"],
    ["dev, unknown origin", dev, "http://evil.test"],
    ["dev, no origin", dev, undefined],
  ] as const)("matches the router for %s", async (_name, options, origin) => {
    expect(browserApiCorsResponseHeaders(options, origin)).toEqual(
      await routerHeaders(options, origin),
    );
  });
});
