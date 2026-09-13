import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { additionalHistoryDirectoriesFor } from "../../../src/main/targets/conversations/historySourceAdapter";

describe("additional history directories", () => {
  it("preserves Pi's custom runtime without duplicating its default sessions", () => {
    const configDir = join("home", "pi");
    expect(additionalHistoryDirectoriesFor("pi", { configDir })).toEqual([]);
    expect(additionalHistoryDirectoriesFor("pi", { configDir, runtimeDir: join(configDir, "sessions") })).toEqual([]);
    const runtimeDir = join("custom", "sessions");
    expect(additionalHistoryDirectoriesFor("pi", { configDir, runtimeDir })).toEqual([runtimeDir]);
  });

  it("does not interpret another Agent's runtime as a Pi history directory", () => {
    expect(additionalHistoryDirectoriesFor("codex", { configDir: "config", runtimeDir: "runtime" })).toEqual([]);
  });
});
