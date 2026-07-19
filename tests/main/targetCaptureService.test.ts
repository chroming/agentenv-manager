import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createTargetCaptureService } from "../../src/main/targetCaptureService";
import type { TargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { TargetInfo } from "../../src/shared/types";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const discovery = (id: string, installed = true): TargetDiscoveryService => ({
  listTargets: async () => [{
    id,
    health: { executableFound: installed, installationFound: installed }
  } as TargetInfo]
});

const setup = async (targetId: string, installed = true) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-capture-v2-"));
  const homeDir = join(root, "home");
  const appDataRoot = join(root, "app-data");
  const paths = createPaths({ appDataRoot, homeDir });
  const targetRegistry = createTargetRegistry();
  const settingsStore = createSettingsStore(paths);
  const profileStore = createProfileStore({ appDataRoot, homeDir }, targetRegistry);
  const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
  const service = createTargetCaptureService({
    paths,
    profileStore,
    targetRegistry,
    skillLibraryStore,
    targetDiscoveryService: discovery(targetId, installed)
  });
  return { homeDir, paths, profileStore, skillLibraryStore, service };
};

describe("target capture service v2", () => {
  it("blocks capture when the Agent command is missing", async () => {
    const { service, profileStore } = await setup("opencode", false);

    await expect(service.previewTarget("opencode")).rejects.toThrow(
      "Agent installation is not detected"
    );
    await expect(profileStore.listProfiles()).resolves.toEqual([]);
  });

  it("captures OpenCode Instructions, Skills, and controllable MCP state without changing it", async () => {
    const { homeDir, paths, service } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    const skillDir = join(targetDir, "skills", "review-workflow");
    const agentDir = join(targetDir, "agents", "reviewer");
    await mkdir(skillDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n");
    await writeFile(join(targetDir, "opencode.jsonc"), JSON.stringify({
      theme: "dark",
      mcp: { docs: { type: "local", command: ["docs"], enabled: false } }
    }, null, 2));
    await writeFile(join(skillDir, "SKILL.md"), [
      "---", "name: review-workflow", "description: Review changes.", "---", "", "# Review", ""
    ].join("\n"));
    await writeFile(join(agentDir, "agent.md"), "# Reviewer\n");

    const preview = await service.previewTarget("opencode");

    expect(preview.errors).toEqual([]);
    expect(preview.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "instructions", action: "include" }),
      expect.objectContaining({ kind: "skill", id: "review-workflow", action: "import" }),
      expect.objectContaining({ kind: "mcp", id: "docs", action: "include" })
    ]));
    expect(preview.resources.some(({ kind }) => !["instructions", "skill", "mcp"].includes(kind)))
      .toBe(false);

    const result = await service.createFromTarget({ previewId: preview.id, name: "Existing" });

    expect(result.profile.manifest).toMatchObject({
      version: 2,
      preferredTargetId: "opencode",
      createdFromTargetId: "opencode"
    });
    expect(result.profile.resources.skills).toEqual([
      { libraryId: "review-workflow", targetName: "review-workflow", enabled: true }
    ]);
    expect(result.profile.resources.mcpByTarget.opencode).toEqual({
      mode: "manage",
      selections: [{ name: "docs", enabled: false }]
    });
    await expect(readFile(join(paths.skillsLibraryDir, "review-workflow", "SKILL.md"), "utf8"))
      .resolves.toContain("# Review");
    await expect(readFile(join(agentDir, "agent.md"), "utf8")).resolves.toBe("# Reviewer\n");
  });

  it("rejects a stale preview before importing anything", async () => {
    const { homeDir, service, profileStore, paths } = await setup("opencode");
    const targetDir = join(homeDir, ".config", "opencode");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, "AGENTS.md"), "# Before\n");
    await writeFile(join(targetDir, "opencode.jsonc"), "{}\n");
    const preview = await service.previewTarget("opencode");
    await writeFile(join(targetDir, "AGENTS.md"), "# Changed\n");

    await expect(service.createFromTarget({ previewId: preview.id, name: "Stale" }))
      .rejects.toThrow("Agent changed after capture preview");
    await expect(profileStore.listProfiles()).resolves.toEqual([]);
    await expect(readFile(paths.skillsLibraryDir)).rejects.toThrow();
  });

  it("reuses identical Library Skills and preserves a different same-name version", async () => {
    const { homeDir, service, skillLibraryStore, paths } = await setup("codex");
    const codexDir = join(homeDir, ".codex");
    const existingSource = join(root, "existing");
    const matchingSource = join(root, "matching");
    const targetConflict = join(codexDir, "skills", "bytedcli");
    const targetMatching = join(codexDir, "skills", "matching");
    for (const path of [existingSource, matchingSource, targetConflict, targetMatching]) {
      await mkdir(path, { recursive: true });
    }
    await writeFile(join(codexDir, "AGENTS.md"), "# Codex\n");
    await writeFile(join(codexDir, "config.toml"), "");
    await writeFile(join(existingSource, "SKILL.md"), "---\nname: bytedcli\n---\n# Library\n");
    await writeFile(join(targetConflict, "SKILL.md"), "---\nname: bytedcli\n---\n# Target\n");
    const matching = "---\nname: matching\n---\n# Same\n";
    await writeFile(join(matchingSource, "SKILL.md"), matching);
    await writeFile(join(targetMatching, "SKILL.md"), matching);
    await skillLibraryStore.importSkill({ sourcePath: existingSource, id: "bytedcli" });
    await skillLibraryStore.importSkill({ sourcePath: matchingSource, id: "matching" });

    const preview = await service.previewTarget("codex");
    expect(preview.resources).toContainEqual(expect.objectContaining({
      id: "matching", libraryId: "matching", action: "reuse"
    }));
    expect(preview.resources).toContainEqual(expect.objectContaining({
      id: "bytedcli", libraryId: "codex-bytedcli", action: "import"
    }));

    const result = await service.createFromTarget({ previewId: preview.id, name: "Codex Existing" });
    expect(result.profile.resources.skills).toEqual(expect.arrayContaining([
      { libraryId: "matching", targetName: "matching", enabled: true },
      { libraryId: "codex-bytedcli", targetName: "bytedcli", enabled: true }
    ]));
    await expect(readFile(join(paths.skillsLibraryDir, "bytedcli", "SKILL.md"), "utf8"))
      .resolves.toContain("# Library");
    await expect(readFile(join(paths.skillsLibraryDir, "codex-bytedcli", "SKILL.md"), "utf8"))
      .resolves.toContain("# Target");
  });

  it("captures Claude MCPs as Agent-controlled and leaves the Profile in ignore mode", async () => {
    const { homeDir, service } = await setup("claude-code");
    const claudeDir = join(homeDir, ".claude");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "CLAUDE.md"), "# Claude\n");
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({ permissions: {} }));
    await writeFile(join(homeDir, ".claude.json"), JSON.stringify({
      mcpServers: { docs: { command: "docs" } }
    }));

    const preview = await service.previewTarget("claude-code");
    expect(preview.resources).toContainEqual(expect.objectContaining({
      kind: "mcp",
      id: "docs",
      detail: "Enabled; remains Agent-controlled"
    }));
    const result = await service.createFromTarget({ previewId: preview.id, name: "Claude Existing" });
    expect(result.profile.resources.mcpByTarget["claude-code"]).toEqual({
      mode: "ignore",
      selections: []
    });
  });

  it("shows ambiguous Trae MCPs for review without capturing them as Profile switches", async () => {
    const { homeDir, service } = await setup("trae-cli");
    const traeDir = join(homeDir, ".trae");
    await mkdir(traeDir, { recursive: true });
    await writeFile(join(traeDir, "AGENTS.md"), "# Trae\n");
    await writeFile(join(traeDir, "trae_cli.yaml"), [
      "mcp_servers:",
      "  - name: docs",
      "    command: docs",
      ""
    ].join("\n"));
    await writeFile(join(traeDir, "mcp.json"), JSON.stringify({
      mcpServers: { docs: { url: "https://example.test/mcp" } }
    }));

    const preview = await service.previewTarget("trae-cli");
    expect(preview.resources).toContainEqual(expect.objectContaining({
      kind: "mcp",
      id: "docs",
      detail: "Enabled; remains Agent-controlled"
    }));

    const result = await service.createFromTarget({
      previewId: preview.id,
      name: "Trae Existing"
    });
    expect(result.profile.resources.mcpByTarget["trae-cli"]).toEqual({
      mode: "ignore",
      selections: []
    });
  });
});
