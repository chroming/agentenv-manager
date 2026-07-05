import { describe, expect, it } from "vitest";
import { preloadScriptName, windowBackgroundColor } from "../../src/main/windowConfig";

describe("window config", () => {
  it("points to the Electron Vite preload output file", () => {
    expect(preloadScriptName).toBe("index.js");
  });

  it("provides a stable page-colored compositor background", () => {
    expect(windowBackgroundColor).toBe("#f6f8fc");
  });
});
