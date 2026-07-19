import { describe, expect, it } from "vitest";
import {
  preloadScriptName,
  windowBackgroundColor,
  windowChromeOptionsFor
} from "../../src/main/windowConfig";

describe("window config", () => {
  it("points to the Electron Vite preload output file", () => {
    expect(preloadScriptName).toBe("index.js");
  });

  it("provides a stable page-colored compositor background", () => {
    expect(windowBackgroundColor).toBe("#f6f8fc");
  });

  it("integrates content with native macOS window controls", () => {
    expect(windowChromeOptionsFor("darwin")).toEqual({ titleBarStyle: "hiddenInset" });
  });

  it("preserves native title bars on other platforms", () => {
    expect(windowChromeOptionsFor("win32")).toEqual({});
    expect(windowChromeOptionsFor("linux")).toEqual({});
  });
});
