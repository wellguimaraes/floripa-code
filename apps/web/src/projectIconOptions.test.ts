import { describe, expect, it } from "vite-plus/test";
import {
  filterProjectIconNames,
  firstEmoji,
  projectIconColorClassName,
  projectImageIconPaths,
  squareImageIconPaths,
} from "./projectIconOptions";

describe("projectIconOptions", () => {
  it("searches across the full Lucide set", () => {
    expect(filterProjectIconNames("alarm clock")).toContain("alarm-clock");
    expect(filterProjectIconNames("alarm  \tclock")).toContain("alarm-clock");
  });

  it("leads with icon-like images until the user searches", () => {
    const paths = [
      "media/hero.png",
      "public/favicon.ico",
      "assets/logo.svg",
      "src/assets/icons/x.png",
    ];
    expect(projectImageIconPaths(paths, "", 10)).toEqual([
      "public/favicon.ico",
      "assets/logo.svg",
      "media/hero.png",
      "src/assets/icons/x.png",
    ]);
    expect(projectImageIconPaths(paths, "hero", 10)).toEqual(paths);
    expect(projectImageIconPaths(paths, "", 1)).toEqual(["public/favicon.ico"]);
  });

  it("leaves out images from docs, tests, snapshots and screenshots", () => {
    const paths = [
      "backend/src/__tests__/unit/pdf/__image_snapshots__/invoice-1.png",
      "frontend/client/docs/docs-assets/flow.png",
      "api/testScaffolding/gross.png",
      "design/Screenshot 2024.png",
      "ai/docs/diagrams/mmd/arch.svg",
      "public/docker-logo.png",
      "public/favicon.ico",
    ];
    expect(projectImageIconPaths(paths, "", 10)).toEqual([
      "public/docker-logo.png",
      "public/favicon.ico",
    ]);
    expect(projectImageIconPaths(paths, "gross", 10)).toEqual([
      "public/docker-logo.png",
      "public/favicon.ico",
    ]);
  });

  it("keeps square images, and unknown sizes, up to the limit", () => {
    const paths = ["icon.png", "snapshot.png", "logo.svg", "favicon.ico", "tile.png"];
    const square = { width: 64, height: 64 };
    const sizes = [square, { width: 800, height: 1100 }, null, null, square];
    expect(squareImageIconPaths(paths, sizes, 10)).toEqual({
      paths: ["icon.png", "logo.svg", "favicon.ico", "tile.png"],
      pending: false,
    });
    expect(squareImageIconPaths(paths, sizes, 2).paths).toEqual(["icon.png", "logo.svg"]);
    // Stops at the first size still being read, so later tiles never shift in ahead of it.
    expect(squareImageIconPaths(paths, [square, undefined, null], 10)).toEqual({
      paths: ["icon.png"],
      pending: true,
    });
    // A wide logo or icon stays, and needs no size to show; a folder name doesn't count.
    expect(
      squareImageIconPaths(
        ["brand/Wide-Logo.png", "icons/banner.png", "app-icon-tall.png"],
        [{ width: 600, height: 200 }, { width: 600, height: 200 }, undefined],
        10,
      ),
    ).toEqual({ paths: ["brand/Wide-Logo.png", "app-icon-tall.png"], pending: false });
  });

  it("extracts one complete emoji grapheme", () => {
    expect(firstEmoji("  👩🏽‍💻 hello")).toBe("👩🏽‍💻");
    expect(firstEmoji("🇺🇸 project")).toBe("🇺🇸");
    expect(firstEmoji("1️⃣ project")).toBe("1️⃣");
    expect(firstEmoji("plain text")).toBeNull();
  });

  it("maps persisted colors to theme-aware classes", () => {
    expect(projectIconColorClassName("violet")).toBe("text-violet-600 dark:text-violet-400");
  });
});
