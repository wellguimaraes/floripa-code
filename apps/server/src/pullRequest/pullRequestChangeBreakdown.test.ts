import { describe, expect, it } from "vite-plus/test";

import { toChangeBreakdown } from "./pullRequestChangeBreakdown.ts";

describe("toChangeBreakdown", () => {
  it("sums each file's lines into the kind its path says", () => {
    expect(
      toChangeBreakdown({
        truncated: false,
        files: [
          { path: "src/a.ts", additions: 10, deletions: 2 },
          { path: "src/b.ts", additions: 5, deletions: 1 },
          { path: "src/a.test.ts", additions: 7, deletions: 0 },
          { path: "pnpm-lock.yaml", additions: 100, deletions: 40 },
          { path: "README.md", additions: 3, deletions: 3 },
        ],
      }),
    ).toEqual({
      code: { additions: 15, deletions: 3 },
      tests: { additions: 7, deletions: 0 },
      mocks: { additions: 0, deletions: 0 },
      generated: { additions: 100, deletions: 40 },
      docs: { additions: 3, deletions: 3 },
    });
  });

  it("gives no split when the host had more files than were read", () => {
    expect(toChangeBreakdown({ truncated: true, files: [] })).toBeNull();
  });
});
