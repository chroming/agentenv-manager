import { describe, expect, it } from "vitest";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import { createAntigravityTargetAdapter } from "../../src/main/targets/integrations/antigravity";
import type { McpLibraryEntry, ProfileDetail } from "../../src/shared/types";

const makeProfile = (targetId: string): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    targetId,
    name: "Daily Coding",
    description: "Test profile",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "",
  configText: targetId === "codex" ? "" : "{}\n",
  assetPolicy: {
    ownedDirs: [],
    ownedFiles: [],
    skillRefs: [],
    mcpRefs: [{ libraryId: "local-search", targetName: "local_search" }],
    disabledSkillPaths: []
  }
});

const legacyServer: McpLibraryEntry = {
  id: "local-search",
  name: "Local Search",
  transport: "stdio",
  command: "node",
  args: ["server.js"],
  env: { SEARCH_TOKEN: "SEARCH_TOKEN" }
};

describe("legacy MCP library references", () => {
  for (const adapter of [
    createOpenCodeTargetAdapter(),
    createClaudeCodeTargetAdapter(),
    createCodexTargetAdapter(),
    createAntigravityTargetAdapter()
  ]) {
    it(`does not materialize definitions for ${adapter.descriptor.name}`, () => {
      const profile = makeProfile(adapter.descriptor.id);

      expect(adapter.materializeMcpRefs(profile, [legacyServer])).toBe(profile);
    });
  }
});
