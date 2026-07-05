import { describe, expect, it } from "vitest";
import { targetProfile } from "../../src/main/profileTargeting";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
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
  configText: '{"mcp":{"native":{}}}',
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
    const result = targetProfile(source, createCodexTargetAdapter());

    expect(result.profile.manifest.targetId).toBe("codex");
    expect(result.profile.instructions).toBe(source.instructions);
    expect(result.profile.configText).toBe("");
    expect(result.profile.assetPolicy.ownedDirs).toEqual([source.assetPolicy.ownedDirs[0]]);
    expect(result.profile.assetPolicy.ownedFiles).toEqual([]);
    expect(result.profile.assetPolicy.skillRefs).toEqual(source.assetPolicy.skillRefs);
    expect(result.profile.assetPolicy.mcpRefs).toEqual(source.assetPolicy.mcpRefs);
    expect(result.profile.assetPolicy.disabledSkillPaths).toEqual([]);
    expect(result.warnings).toEqual([
      "opencode Advanced config is target-specific and is not applied to Codex",
      "2 target-specific agent assets are not applied to Codex",
      "Disabled skill paths are target-specific and are not applied to Codex"
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
});
