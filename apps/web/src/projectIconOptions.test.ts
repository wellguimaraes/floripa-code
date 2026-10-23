import { describe, expect, it } from "vite-plus/test";
import {
  filterProjectIconNames,
  firstEmoji,
  projectIconColorClassName,
  projectImageIconPaths,
} from "./projectIconOptions";

describe("projectIconOptions", () => {
  it("searches across the full Lucide set", () => {
    expect(filterProjectIconNames("alarm clock")).toContain("alarm-clock");
    expect(filterProjectIconNames("alarm  \tclock")).toContain("alarm-clock");
  });

  it("leads with icon-like images until the user searches", () => {
    const paths = [
      "docs/hero.png",
      "public/favicon.ico",
      "assets/logo.svg",
      "src/assets/icons/x.png",
    ];
    expect(projectImageIconPaths(paths, "", 10)).toEqual([
      "public/favicon.ico",
      "assets/logo.svg",
      "docs/hero.png",
      "src/assets/icons/x.png",
    ]);
    expect(projectImageIconPaths(paths, "hero", 10)).toEqual(paths);
    expect(projectImageIconPaths(paths, "", 1)).toEqual(["public/favicon.ico"]);
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
