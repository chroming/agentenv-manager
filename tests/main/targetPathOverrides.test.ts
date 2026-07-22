import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTargetRegistry } from "../../src/main/targets/registry";

describe("target configuration root overrides", () => {
  it("lets every production adapter derive its resources from one root override", () => {
    const homeDir = "/tmp/agentenv-home";
    const override = "/tmp/agentenv-custom-root";
    const expectedConfigDirs: Record<string, string> = {
      codex: override,
      opencode: override,
      "claude-code": override,
      antigravity: join(override, "config"),
      "trae-cli": override
    };

    for (const adapter of createTargetRegistry().listAdapters()) {
      const paths = adapter.createTargetPaths({ homeDir, rootDirOverride: override });
      expect(paths.configDir, adapter.descriptor.id).toBe(expectedConfigDirs[adapter.descriptor.id]);
      expect(paths.instructionsPath.startsWith(override), adapter.descriptor.id).toBe(true);
      expect(paths.skillsDir?.startsWith(override), adapter.descriptor.id).toBe(true);
    }
  });
});
