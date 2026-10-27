import { describe, expect, it } from "vite-plus/test";

import { resolvePackageScripts } from "./packageScripts";

const packageJson = (fields: Record<string, unknown>) => JSON.stringify(fields);

describe("resolvePackageScripts", () => {
  it("runs package.json scripts with the declared package manager", () => {
    const scripts = resolvePackageScripts(new Set(["package.json", "yarn.lock"]), {
      "package.json": packageJson({
        packageManager: "pnpm@9.1.0",
        scripts: { dev: "vite", "build:web": "vite build" },
      }),
    });
    expect(scripts.map((script) => script.command)).toEqual(["pnpm run dev", "pnpm run build:web"]);
  });

  it("falls back to the lockfile, then npm", () => {
    const manifest = { "package.json": packageJson({ scripts: { test: "vitest" } }) };
    expect(resolvePackageScripts(new Set(["bun.lock"]), manifest)[0]?.command).toBe("bun run test");
    expect(resolvePackageScripts(new Set(), manifest)[0]?.command).toBe("npm run test");
  });

  it("quotes names the shell would split", () => {
    const scripts = resolvePackageScripts(new Set(), {
      "package.json": packageJson({ scripts: { "it's ready": "echo" } }),
    });
    expect(scripts[0]?.command).toBe(`npm run 'it'\\''s ready'`);
  });

  it("lists deno tasks and composer scripts, skipping unparsable manifests", () => {
    const scripts = resolvePackageScripts(new Set(), {
      "package.json": "{ not json",
      "deno.json": JSON.stringify({ tasks: { start: "deno run main.ts" } }),
      "composer.json": JSON.stringify({ scripts: { lint: "phpcs" } }),
    });
    expect(scripts.map((script) => script.command)).toEqual([
      "deno task start",
      "composer run-script lint",
    ]);
  });
});
