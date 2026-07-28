import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  constrainWindowState,
  parseWindowState,
  readWindowState,
  writeWindowState
} from "../../src/main/windowStateStore";

describe("window state store", () => {
  it("rejects malformed state without throwing", () => {
    expect(parseWindowState({ width: "large" })).toBeUndefined();
    const path = join(mkdtempSync(join(tmpdir(), "agentenv-window-")), "window.json");
    writeFileSync(path, "{broken");
    expect(readWindowState(path)).toBeUndefined();
  });

  it("constrains restored bounds to the available display", () => {
    expect(constrainWindowState({
      x: 4_000,
      y: -2_000,
      width: 1_800,
      height: 1_400,
      maximized: true
    }, {
      x: 100,
      y: 40,
      width: 1_200,
      height: 800
    })).toEqual({
      x: 100,
      y: 40,
      width: 1_200,
      height: 800,
      maximized: true
    });
  });

  it("writes a complete state atomically", () => {
    const path = join(mkdtempSync(join(tmpdir(), "agentenv-window-")), "window.json");
    writeWindowState(path, {
      x: 20,
      y: 30,
      width: 1_180,
      height: 760,
      maximized: false
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      x: 20,
      y: 30,
      width: 1_180,
      height: 760,
      maximized: false
    });
  });
});
