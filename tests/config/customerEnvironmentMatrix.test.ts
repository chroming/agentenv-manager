import { describe, expect, it } from "vitest";
import { loadMachineScenarioCatalog } from "../machine-scenarios/catalog";

const targetIds = [
  "opencode",
  "claude-code",
  "codex",
  "antigravity",
  "trae-cli",
  "pi"
] as const;
const platforms = ["darwin", "linux", "win32"] as const;

describe("customer environment matrix", () => {
  it("keeps a substantial deterministic compatibility corpus", async () => {
    const scenarios = await loadMachineScenarioCatalog();
    expect(scenarios.length).toBeGreaterThanOrEqual(30);
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length);
  });

  it.each(platforms)("covers every built-in Target on %s", async (platform) => {
    const scenarios = await loadMachineScenarioCatalog();
    for (const targetId of targetIds) {
      const supported = scenarios.filter(
        (scenario) =>
          scenario.targetId === targetId && scenario.platforms.includes(platform)
      );
      expect(
        supported.length,
        `${targetId} must keep at least three ${platform} machine layouts`
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps high-risk topology classes in the corpus", async () => {
    const scenarios = await loadMachineScenarioCatalog();
    const serialized = JSON.stringify(scenarios);
    for (const required of [
      "broken",
      "duplicate",
      "collection-link",
      "custom",
      "legacy",
      "shared"
    ]) {
      expect(serialized).toContain(required);
    }
  });
});
