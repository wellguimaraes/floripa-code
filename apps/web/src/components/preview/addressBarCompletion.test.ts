import { describe, expect, it } from "vite-plus/test";

import { findAddressBarCompletion } from "./addressBarCompletion";

const history = [
  "http://localhost:5173/settings",
  "https://www.example.com/",
  "http://localhost:5173/",
];

describe("findAddressBarCompletion", () => {
  it("completes the most recent match without its scheme", () => {
    expect(findAddressBarCompletion(history, "loc")).toEqual({
      typed: "loc",
      text: "localhost:5173/settings",
      url: "http://localhost:5173/settings",
    });
  });

  it("matches past www and shows a root URL as its host", () => {
    expect(findAddressBarCompletion(history, "Exa")).toEqual({
      typed: "Exa",
      text: "Example.com",
      url: "https://www.example.com/",
    });
  });

  it("matches a typed scheme", () => {
    expect(findAddressBarCompletion(history, "https://w")?.url).toBe("https://www.example.com/");
  });

  it("skips entries that only equal what was typed", () => {
    expect(findAddressBarCompletion(["http://localhost:5173/"], "localhost:5173")).toBeNull();
  });

  it("ignores empty input and search phrases", () => {
    expect(findAddressBarCompletion(history, "")).toBeNull();
    expect(findAddressBarCompletion(history, "local host")).toBeNull();
  });
});
