import { describe, expect, it } from "vite-plus/test";
import { mathKind } from "./markdownMath.ts";

describe("mathKind", () => {
  it("reads the classes remark-math emits", () => {
    expect(mathKind("language-math math-inline")).toBe("inline");
    expect(mathKind("language-math math-display")).toBe("display");
  });
  it("ignores ordinary and plain math fences", () => {
    expect(mathKind(undefined)).toBeNull();
    expect(mathKind("language-ts")).toBeNull();
    expect(mathKind("language-math")).toBeNull();
  });
});
