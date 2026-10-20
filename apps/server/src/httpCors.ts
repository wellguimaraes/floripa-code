import { ORCHESTRATION_PROTOCOL_HEADER } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as ServerConfig from "./config.ts";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

const DESKTOP_RENDERER_ORIGINS = ["floripacode://app", "floripacode-dev://app"];

/**
 * The CORS policy for browser API routes. DeviceHubProxy also applies it to
 * the device streams its relay answers outside the router.
 */
export const browserApiCorsOptions = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const devOrigin = config.devUrl?.origin;
  // Dev uses credentialed requests from Vite or the Electron custom origin, so both must be
  // explicit. Packaged desktop omits credentials and uses Effect's default wildcard origin.
  //
  // FLORIPACODE_DEV_ALLOWED_ORIGINS covers dev servers reached from a second
  // origin — a tailnet name, a LAN IP, a phone. Browser dev normally proxies
  // through Vite and is same-origin (no preflight at all), so this is a
  // safety net for the desktop renderer and any direct-to-backend caller.
  return {
    ...(devOrigin
      ? {
          allowedOrigins: [devOrigin, ...DESKTOP_RENDERER_ORIGINS, ...config.devAllowedOrigins],
          credentials: true,
        }
      : {}),
    allowedMethods: browserApiCorsAllowedMethods,
    allowedHeaders: browserApiCorsAllowedHeaders,
    maxAge: 600,
  };
});

/**
 * The CORS headers the router's middleware adds to a non-preflight response,
 * for responses written outside the router.
 */
export const browserApiCorsResponseHeaders = (
  options: { readonly allowedOrigins?: ReadonlyArray<string>; readonly credentials?: boolean },
  origin: string | undefined,
): Record<string, string> => {
  const allowedOrigins = options.allowedOrigins ?? [];
  if (allowedOrigins.length === 0) return { "access-control-allow-origin": "*" };
  return {
    vary: "Origin",
    ...(origin !== undefined && allowedOrigins.includes(origin)
      ? { "access-control-allow-origin": origin }
      : {}),
    ...(options.credentials ? { "access-control-allow-credentials": "true" } : {}),
  };
};
