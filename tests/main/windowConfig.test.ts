import { describe, expect, it } from "vitest";
import { preloadScriptName } from "../../src/main/windowConfig";

describe("window config", () => {
  it("points to the Electron Vite preload output file", () => {
    expect(preloadScriptName).toBe("index.js");
  });
});
