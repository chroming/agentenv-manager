import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import type { ProfileDetail, TargetState } from "../../../src/shared/types";

let root = "";

const makeProfile = (configText: string): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    targetId: "opencode",
    name: "Daily Coding",
    description: "OpenCode profile",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "# OpenCode instructions\n",
  configText,
  assetPolicy: {
    ownedDirs: [
      { kind: "agent", source: "agents/reviewer", targetName: "reviewer" },
      { kind: "skill", source: "skills/reviewer", targetName: "agentenv-reviewer" }
    ],
    ownedFiles: [],
    skillRefs: [],
    disabledSkillPaths: []
  }
});

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("OpenCode target adapter", () => {
  const writeOwnerMarker = async (
    targetDir: string,
    marker: Record<string, unknown> = {
      owner: "agentenv-manager",
      profileId: "daily-coding",
      targetId: "opencode",
      kind: "skill",
      source: "skills/reviewer"
    }
  ) => {
    await writeFile(
      join(targetDir, ".agentenv-owner.json"),
      `${JSON.stringify(marker, null, 2)}\n`
    );
  };

  it("plans instructions, JSONC overlay, and managed MCP state without clobbering unmanaged config", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.instructionsPath, "# Old instructions\n", "utf8");
    await writeFile(
      targetPaths.configPath,
      [
        "{",
        "  // user preference",
        '  "theme": "system",',
        '  "permission": { "bash": "allow" },',
        '  "mcp": {',
        '    "old-managed": { "type": "local", "command": ["old"] },',
        '    "unmanaged": { "type": "remote", "url": "https://example.com/mcp" }',
        "  }",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );

    const profile = makeProfile(
      JSON.stringify(
        {
          permission: { bash: "ask" },
          mcp: {
            context7: {
              type: "remote",
              url: "https://mcp.context7.com/mcp"
            }
          }
        },
        null,
        2
      )
    );
    const state: TargetState = {
      managedConfigKeys: ["permission"],
      managedMcpNames: ["old-managed"]
    };

    const preview = await adapter.createPreview({ profile, targetPaths, state });

    expect(preview.errors).toEqual([]);
    const configChange = preview.changes.find((change) =>
      change.path.endsWith("opencode.json")
    );
    expect(configChange).toBeDefined();
    const parsed = parse(configChange?.after ?? "") as Record<string, unknown>;
    expect(parsed).toMatchObject({
      theme: "system",
      permission: { bash: "ask" },
      mcp: {
        unmanaged: { type: "remote", url: "https://example.com/mcp" },
        context7: { type: "remote", url: "https://mcp.context7.com/mcp" }
      }
    });
    expect((parsed.mcp as Record<string, unknown>)["old-managed"]).toBeUndefined();
    expect(preview.targetState).toEqual({
      managedConfigKeys: ["permission"],
      managedMcpNames: ["context7"]
    });
  });

  it("reports unmanaged MCP name conflicts before apply", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(
      targetPaths.configPath,
      JSON.stringify({
        mcp: {
          context7: {
            type: "remote",
            url: "https://example.com/existing"
          }
        }
      }),
      "utf8"
    );

    const profile = makeProfile(
      JSON.stringify({
        mcp: {
          context7: {
            type: "remote",
            url: "https://mcp.context7.com/mcp"
          }
        }
      })
    );

    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    expect(preview.errors).toContain(
      "MCP server context7 already exists outside AgentEnv management"
    );
  });

  it("copies owned OpenCode agent and skill directories only after validating sources", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const profileDir = join(root, "profiles", "daily-coding");
    await mkdir(join(profileDir, "agents", "reviewer"), { recursive: true });
    await mkdir(join(profileDir, "skills", "reviewer"), { recursive: true });
    await writeFile(join(profileDir, "agents", "reviewer", "AGENTS.md"), "# Agent\n");
    await writeFile(join(profileDir, "skills", "reviewer", "SKILL.md"), "# Skill\n");
    const profile = { ...makeProfile("{}"), profileDir };

    const errors = await adapter.validateAssets({ profile, targetPaths });
    expect(errors).toEqual([]);

    await adapter.applyAssets({ profile, targetPaths });

    await expect(
      readFile(join(targetPaths.agentsDir ?? "", "reviewer", "AGENTS.md"), "utf8")
    ).resolves.toBe("# Agent\n");
    await expect(
      readFile(join(targetPaths.skillsDir ?? "", "agentenv-reviewer", "SKILL.md"), "utf8")
    ).resolves.toBe("# Skill\n");
  });

  it("links reusable library skills into the OpenCode skills directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const skillLibraryDir = join(root, "app-data", "skills-library");
    const librarySkillDir = join(skillLibraryDir, "shared-reviewer");
    await mkdir(join(librarySkillDir, "references"), { recursive: true });
    await writeFile(join(librarySkillDir, "SKILL.md"), "# Shared reviewer\n");
    await writeFile(join(librarySkillDir, "references", "guide.md"), "# Guide\n");
    const profile: ProfileDetail = {
      ...makeProfile("{}"),
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [
          {
            libraryId: "shared-reviewer",
            targetName: "agentenv-shared-reviewer"
          }
        ],
        disabledSkillPaths: []
      }
    };

    await expect(
      adapter.validateAssets({ profile, targetPaths, skillLibraryDir })
    ).resolves.toEqual([]);
    await adapter.applyAssets({ profile, targetPaths, skillLibraryDir });

    const targetDir = join(targetPaths.skillsDir ?? "", "agentenv-shared-reviewer");
    await expect(readFile(join(targetDir, "SKILL.md"), "utf8")).resolves.toBe(
      "# Shared reviewer\n"
    );
    await expect(readFile(join(targetDir, "references", "guide.md"), "utf8")).resolves.toBe(
      "# Guide\n"
    );
    expect((await lstat(join(targetDir, "SKILL.md"))).isSymbolicLink()).toBe(true);
    await expect(readlink(join(targetDir, "SKILL.md"))).resolves.toBe(
      join(librarySkillDir, "SKILL.md")
    );
    await expect(readFile(join(targetDir, ".agentenv-owner.json"), "utf8")).resolves.toContain(
      '"source": "skills-library/shared-reviewer"'
    );
  });

  it("can copy reusable library skills when symlinks are not desired", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const skillLibraryDir = join(root, "app-data", "skills-library");
    const librarySkillDir = join(skillLibraryDir, "shared-reviewer");
    await mkdir(librarySkillDir, { recursive: true });
    await writeFile(join(librarySkillDir, "SKILL.md"), "# Shared reviewer\n");
    const profile: ProfileDetail = {
      ...makeProfile("{}"),
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [{ libraryId: "shared-reviewer", targetName: "agentenv-shared-reviewer" }],
        disabledSkillPaths: []
      }
    };

    await adapter.applyAssets({
      profile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: "copy"
    });

    const targetSkillMd = join(targetPaths.skillsDir ?? "", "agentenv-shared-reviewer", "SKILL.md");
    await expect(readFile(targetSkillMd, "utf8")).resolves.toBe("# Shared reviewer\n");
    expect((await lstat(targetSkillMd)).isSymbolicLink()).toBe(false);
  });

  it("rejects reusable library skills that target the same skill directory as profile assets", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const skillLibraryDir = join(root, "app-data", "skills-library");
    const profileDir = join(root, "profiles", "daily-coding");
    await mkdir(join(profileDir, "skills", "reviewer"), { recursive: true });
    await writeFile(join(profileDir, "skills", "reviewer", "SKILL.md"), "# Profile reviewer\n");
    await mkdir(join(skillLibraryDir, "shared-reviewer"), { recursive: true });
    await writeFile(join(skillLibraryDir, "shared-reviewer", "SKILL.md"), "# Shared reviewer\n");
    const profile: ProfileDetail = {
      ...makeProfile("{}"),
      profileDir,
      assetPolicy: {
        ownedDirs: [
          { kind: "skill", source: "skills/reviewer", targetName: "agentenv-reviewer" }
        ],
        ownedFiles: [],
        skillRefs: [
          {
            libraryId: "shared-reviewer",
            targetName: "agentenv-reviewer"
          }
        ],
        disabledSkillPaths: []
      }
    };

    await expect(
      adapter.validateAssets({ profile, targetPaths, skillLibraryDir })
    ).resolves.toContain(
      "Skill target agentenv-reviewer is declared more than once: skills/reviewer and skills-library/shared-reviewer"
    );
  });

  it("does not trust a target directory just because it contains an owner marker file", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const profileDir = join(root, "profiles", "daily-coding");
    await mkdir(join(profileDir, "skills", "reviewer"), { recursive: true });
    await writeFile(join(profileDir, "skills", "reviewer", "SKILL.md"), "# Skill\n");
    const targetDir = join(targetPaths.skillsDir ?? "", "agentenv-reviewer");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, ".agentenv-owner.json"), "{}\n");

    const profile: ProfileDetail = {
      ...makeProfile("{}"),
      profileDir,
      assetPolicy: {
        ownedDirs: [
          { kind: "skill", source: "skills/reviewer", targetName: "agentenv-reviewer" }
        ],
        ownedFiles: [],
        skillRefs: [],
        disabledSkillPaths: []
      }
    };

    await expect(
      adapter.validateAssets({ profile, targetPaths })
    ).resolves.toContain(
      `skill target already exists and is not AgentEnv-owned: ${targetDir}`
    );
  });

  it("removes stale AgentEnv-owned OpenCode agents and skills when switching profiles", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-opencode-"));
    const adapter = createOpenCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const profileDir = join(root, "profiles", "daily-coding");
    await mkdir(join(profileDir, "skills", "next"), { recursive: true });
    await mkdir(join(profileDir, "agents", "next"), { recursive: true });
    await writeFile(join(profileDir, "skills", "next", "SKILL.md"), "# Next skill\n");
    await writeFile(join(profileDir, "agents", "next", "AGENTS.md"), "# Next agent\n");

    const staleSkillDir = join(targetPaths.skillsDir ?? "", "agentenv-old-skill");
    const staleAgentDir = join(targetPaths.agentsDir ?? "", "old-agent");
    const unmanagedSkillDir = join(targetPaths.skillsDir ?? "", "user-skill");
    await mkdir(staleSkillDir, { recursive: true });
    await mkdir(staleAgentDir, { recursive: true });
    await mkdir(unmanagedSkillDir, { recursive: true });
    await writeOwnerMarker(staleSkillDir);
    await writeFile(join(staleSkillDir, "SKILL.md"), "# Old skill\n");
    await writeOwnerMarker(staleAgentDir, {
      owner: "agentenv-manager",
      profileId: "daily-coding",
      targetId: "opencode",
      kind: "agent",
      source: "agents/reviewer"
    });
    await writeFile(join(staleAgentDir, "AGENTS.md"), "# Old agent\n");
    await writeFile(join(unmanagedSkillDir, "SKILL.md"), "# User skill\n");

    const profile: ProfileDetail = {
      ...makeProfile("{}"),
      profileDir,
      assetPolicy: {
        ownedDirs: [
          { kind: "skill", source: "skills/next", targetName: "agentenv-next-skill" },
          { kind: "agent", source: "agents/next", targetName: "next-agent" }
        ],
        ownedFiles: [],
        skillRefs: [],
        disabledSkillPaths: []
      }
    };

    await adapter.applyAssets({ profile, targetPaths });

    await expect(readFile(join(staleSkillDir, "SKILL.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(staleAgentDir, "AGENTS.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(unmanagedSkillDir, "SKILL.md"), "utf8")).resolves.toBe(
      "# User skill\n"
    );
    await expect(
      readFile(join(targetPaths.skillsDir ?? "", "agentenv-next-skill", "SKILL.md"), "utf8")
    ).resolves.toBe("# Next skill\n");
    await expect(
      readFile(join(targetPaths.agentsDir ?? "", "next-agent", "AGENTS.md"), "utf8")
    ).resolves.toBe("# Next agent\n");
  });
});
