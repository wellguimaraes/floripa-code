import { expect, it } from "vite-plus/test";

import { homeBrowseItems, homeBrowseTarget } from "./homePathBrowse";

it("reads every @ query from ~, keeping what was typed", () => {
  expect(homeBrowseTarget("")).toEqual({ partialPath: "~/", folder: "~/" });
  expect(homeBrowseTarget("Doc")).toEqual({ partialPath: "~/Doc", folder: "~/" });
  expect(homeBrowseTarget("~")).toEqual({ partialPath: "~", folder: "~/" });
  expect(homeBrowseTarget("~Doc")).toEqual({ partialPath: "~/Doc", folder: "~/" });
  expect(homeBrowseTarget("~/Documents/rep")).toEqual({
    partialPath: "~/Documents/rep",
    folder: "~/Documents/",
  });
  expect(homeBrowseTarget("/etc/ho")).toEqual({ partialPath: "/etc/ho", folder: "/etc/" });
  expect(homeBrowseTarget("Photos/")).toEqual({ partialPath: "~/Photos/", folder: "~/Photos/" });
});

const listing = {
  parentPath: "/Users/me/Photos",
  entries: [
    { name: "2026", fullPath: "/Users/me/Photos/2026", kind: "directory" as const },
    { name: "cat.png", fullPath: "/Users/me/Photos/cat.png", kind: "file" as const },
  ],
};

it("opens folders and inserts files, offering a typed folder itself first", () => {
  const items = homeBrowseItems(homeBrowseTarget("~/Photos/"), listing);
  expect(
    items.map((item) =>
      item.type === "path" ? [item.label, item.path, item.browseTo ?? null] : null,
    ),
  ).toEqual([
    [".", "/Users/me/Photos", null],
    ["2026", "/Users/me/Photos/2026", "~/Photos/2026/"],
    ["cat.png", "/Users/me/Photos/cat.png", null],
  ]);
});

it("offers no folder of its own while a name is being typed, or at home", () => {
  const typing = homeBrowseItems(homeBrowseTarget("~/Photos/c"), listing);
  expect(typing.map((item) => item.label)).toEqual(["2026", "cat.png"]);

  const home = homeBrowseItems(homeBrowseTarget(""), { parentPath: "/Users/me", entries: [] });
  expect(home).toEqual([]);
});

it("treats entries from servers that predate files as folders", () => {
  const [entry] = homeBrowseItems(homeBrowseTarget(""), {
    parentPath: "/Users/me",
    entries: [{ name: "Code", fullPath: "/Users/me/Code" }],
  });
  expect(entry).toMatchObject({ pathKind: "directory", browseTo: "~/Code/" });
});
