import { describe, expect, it } from "vitest";
import { targetProfile } from "../../src/main/profileTargeting";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { ProfileDetail } from "../../src/shared/types";

const source: ProfileDetail = {
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    targetId: "opencode",
    name: "Daily Coding",
    description: "",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "# Shared instructions\n",
  configText: '{"theme":"dark","mcp":{"native":{}}}',
  assetPolicy: {
    ownedDirs: [
      { kind: "skill", source: "skills/review", targetName: "review" },
      { kind: "agent", source: "agents/reviewer", targetName: "reviewer" }
    ],
    ownedFiles: [{ kind: "agent", source: "agents/reviewer.md", targetName: "reviewer.md" }],
    skillRefs: [{ libraryId: "shared-review", targetName: "shared-review" }],
    mcpRefs: [{ libraryId: "github", targetName: "github" }],
    disabledSkillPaths: ["legacy-skill"]
  },
  contentHash: "native-hash"
};

describe("profile target adaptation", () => {
  it("keeps portable resources and omits target-specific state", () => {
    const result = targetProfile(
      source,
      createCodexTargetAdapter(),
      createOpenCodeTargetAdapter()
    );

    expect(result.profile.manifest.targetId).toBe("codex");
    expect(result.profile.instructions).toBe(source.instructions);
    expect(result.profile.configText).toBe("");
    expect(result.profile.assetPolicy.ownedDirs).toEqual([source.assetPolicy.ownedDirs[0]]);
    expect(result.profile.assetPolicy.ownedFiles).toEqual([]);
    expect(result.profile.assetPolicy.skillRefs).toEqual(source.assetPolicy.skillRefs);
    expect(result.profile.assetPolicy.mcpRefs).toEqual([]);
    expect(result.profile.assetPolicy.disabledSkillPaths).toEqual([]);
    expect(result.warnings).toEqual([
      "opencode Advanced config is Agent-specific and is not applied to Codex",
      "2 native agent assets are not applied to Codex",
      "Disabled Skill paths are Agent-specific and are not applied to Codex"
    ]);
  });

  it("leaves the native target profile untouched", () => {
    const nativeSource = {
      ...source,
      manifest: { ...source.manifest, targetId: "codex" }
    };

    expect(targetProfile(nativeSource, createCodexTargetAdapter())).toEqual({
      profile: nativeSource,
      warnings: [],
      omissions: []
    });
  });

  it("does not report schema-only or MCP-only default config as an omission", () => {
    const codex = createCodexTargetAdapter();
    const claude = createClaudeCodeTargetAdapter();
    const antigravity = createTargetRegistry().get("antigravity");

    for (const sourceAdapter of [claude, antigravity]) {
      const defaultProfile = sourceAdapter.createDefaultProfile("portable-default");
      const result = targetProfile(defaultProfile, codex, sourceAdapter);
      expect(result.omissions.filter((omission) => omission.kind === "config")).toEqual([]);
    }
  });

  it("still reports meaningful Agent-native config as an omission", () => {
    const claude = createClaudeCodeTargetAdapter();
    const claudeProfile = claude.createDefaultProfile("claude-native");
    claudeProfile.configText = JSON.stringify({
      settings: {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        model: "opus"
      },
      mcpServers: {}
    });

    expect(
      targetProfile(claudeProfile, createCodexTargetAdapter(), claude).omissions
    ).toContainEqual(expect.objectContaining({ kind: "config" }));
  });
});
