import { describe, expect, it } from "vite-plus/test";

import {
  claimWorkspaceBasenameLookup,
  needsWorkspacePathLookup,
  pickWorkspacePathMatch,
} from "./workspaceBasenameLookup";

describe("needsWorkspacePathLookup", () => {
  it("flags bare filenames", () => {
    expect(needsWorkspacePathLookup("ChatView.tsx")).toBe(true);
    expect(needsWorkspacePathLookup("Makefile")).toBe(true);
  });

  it("flags relative paths that may start inside a package", () => {
    expect(needsWorkspacePathLookup("src/specs/maintenance-api.yaml")).toBe(true);
  });

  it("leaves anchored paths alone", () => {
    expect(needsWorkspacePathLookup("/repo/src/ChatView.tsx")).toBe(false);
    expect(needsWorkspacePathLookup("C:/repo/ChatView.tsx")).toBe(false);
    expect(needsWorkspacePathLookup("~/notes.md")).toBe(false);
    expect(needsWorkspacePathLookup("./ChatView.tsx")).toBe(false);
    expect(needsWorkspacePathLookup("apps\\web\\ChatView.tsx")).toBe(false);
    expect(needsWorkspacePathLookup(".")).toBe(false);
    expect(needsWorkspacePathLookup("..")).toBe(false);
    expect(needsWorkspacePathLookup("   ")).toBe(false);
  });
});

describe("pickWorkspacePathMatch", () => {
  const entries = [
    { path: "apps/web/src/components/ChatView.test.tsx", kind: "file" as const },
    { path: "apps/web/src/components/ChatView.tsx", kind: "file" as const },
  ];

  it("takes the first exact filename match, not the closest fuzzy one", () => {
    expect(pickWorkspacePathMatch("ChatView.tsx", entries)).toBe(
      "apps/web/src/components/ChatView.tsx",
    );
  });

  it("ignores directories", () => {
    expect(
      pickWorkspacePathMatch("components", [
        { path: "apps/web/src/components", kind: "directory" },
        { path: "apps/web/src/components/components", kind: "file" },
      ]),
    ).toBe("apps/web/src/components/components");
  });

  it("prefers the exactly-cased file over a case-only twin", () => {
    expect(
      pickWorkspacePathMatch("foo.ts", [
        { path: "src/Foo.ts", kind: "file" },
        { path: "src/foo.ts", kind: "file" },
      ]),
    ).toBe("src/foo.ts");
  });

  it("falls back to case-insensitive when only the casing differs", () => {
    expect(pickWorkspacePathMatch("chatview.tsx", entries)).toBe(
      "apps/web/src/components/ChatView.tsx",
    );
  });

  it("returns null when the case-insensitive fallback is ambiguous", () => {
    expect(
      pickWorkspacePathMatch("FOO.ts", [
        { path: "src/Foo.ts", kind: "file" },
        { path: "src/foo.ts", kind: "file" },
      ]),
    ).toBeNull();
  });

  it("keeps a path that is already workspace-relative", () => {
    expect(
      pickWorkspacePathMatch("src/index.ts", [
        { path: "packages/a/src/index.ts", kind: "file" },
        { path: "src/index.ts", kind: "file" },
      ]),
    ).toBe("src/index.ts");
  });

  it("finds the one file a package-relative path ends", () => {
    expect(
      pickWorkspacePathMatch("src/specs/maintenance-api.yaml", [
        { path: "frontend/api-client/src/specs/maintenance-api.yaml", kind: "file" },
        { path: "frontend/api-client/src/xspecs/maintenance-api.yaml", kind: "file" },
        { path: "backend/maintenance/src/maintenance-api.ts", kind: "file" },
      ]),
    ).toBe("frontend/api-client/src/specs/maintenance-api.yaml");
  });

  it("returns null when several packages end in the path", () => {
    expect(
      pickWorkspacePathMatch("src/index.ts", [
        { path: "packages/a/src/index.ts", kind: "file" },
        { path: "packages/b/src/index.ts", kind: "file" },
      ]),
    ).toBeNull();
  });

  it("returns null when nothing matches the name", () => {
    expect(pickWorkspacePathMatch("ChatView.tsx", [])).toBeNull();
    expect(
      pickWorkspacePathMatch("ChatView.tsx", [
        { path: "apps/web/src/components/ChatHeader.tsx", kind: "file" },
      ]),
    ).toBeNull();
  });
});

describe("claimWorkspaceBasenameLookup", () => {
  it("keeps only the newest claim, whatever order the lookups settle in", () => {
    const first = claimWorkspaceBasenameLookup();
    const second = claimWorkspaceBasenameLookup();

    // The older lookup answering last must not reopen the panel behind the
    // newer one.
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });

  it("stays valid while it is the only claim", () => {
    const only = claimWorkspaceBasenameLookup();
    expect(only()).toBe(true);
  });
});
