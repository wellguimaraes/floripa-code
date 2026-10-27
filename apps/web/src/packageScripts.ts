import type { ProjectScript } from "@t3tools/contracts";

/** A script a package manifest declares, runnable from the worktree root. */
export interface PackageScript {
  readonly id: string;
  readonly name: string;
  /** The tool that runs it, e.g. `pnpm` or `deno`. */
  readonly runner: string;
  readonly command: string;
}

/** Runs a package script the way a saved project command runs. */
export function packageScriptAsProjectScript(script: PackageScript): ProjectScript {
  return {
    id: script.id,
    name: script.name,
    command: script.command,
    icon: "play",
    runOnWorktreeCreate: false,
  };
}

/** Root files whose scripts the actions popover lists. */
export const PACKAGE_MANIFEST_FILES = [
  "package.json",
  "deno.json",
  "deno.jsonc",
  "composer.json",
] as const;
export type PackageManifestFile = (typeof PACKAGE_MANIFEST_FILES)[number];

type NodePackageManager = "npm" | "pnpm" | "yarn" | "bun";

const LOCKFILE_MANAGERS: ReadonlyArray<readonly [string, NodePackageManager]> = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

function parseObject(contents: string | null): Record<string, unknown> | null {
  if (contents === null) return null;
  try {
    const value: unknown = JSON.parse(contents);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function objectKeys(value: unknown): ReadonlyArray<string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value)
    : [];
}

/** Single-quotes a script name the shell would otherwise split or expand. */
function shellWord(value: string): string {
  return /^[\w:.@/+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The `packageManager` field wins, then the lockfile beside the manifest, then npm. */
export function detectNodePackageManager(
  packageJson: Record<string, unknown>,
  rootFiles: ReadonlySet<string>,
): NodePackageManager {
  const declared = packageJson.packageManager;
  if (typeof declared === "string") {
    const name = declared.split("@")[0];
    if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") return name;
  }
  return LOCKFILE_MANAGERS.find(([file]) => rootFiles.has(file))?.[1] ?? "npm";
}

/**
 * The scripts the root manifests declare. `manifests` holds each present manifest's contents;
 * one that is missing or unparsable adds nothing.
 */
export function resolvePackageScripts(
  rootFiles: ReadonlySet<string>,
  manifests: Partial<Record<PackageManifestFile, string | null>>,
): ReadonlyArray<PackageScript> {
  const scripts: PackageScript[] = [];
  const add = (runner: string, run: string, names: ReadonlyArray<string>) => {
    for (const name of names) {
      scripts.push({ id: `${runner}:${name}`, name, runner, command: `${run} ${shellWord(name)}` });
    }
  };

  const packageJson = parseObject(manifests["package.json"] ?? null);
  if (packageJson) {
    const manager = detectNodePackageManager(packageJson, rootFiles);
    add(manager, `${manager} run`, objectKeys(packageJson.scripts));
  }
  const deno =
    parseObject(manifests["deno.json"] ?? null) ?? parseObject(manifests["deno.jsonc"] ?? null);
  if (deno) add("deno", "deno task", objectKeys(deno.tasks));
  const composer = parseObject(manifests["composer.json"] ?? null);
  if (composer) add("composer", "composer run-script", objectKeys(composer.scripts));
  return scripts;
}
