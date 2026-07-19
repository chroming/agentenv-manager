import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeCodeTargetAdapter } from "../../../src/main/targets/claudeCodeTarget";
import type { ProfileDetail, TargetState } from "../../../src/shared/types";

let root = "";

const makeProfile = (configText: string): ProfileDetail => ({
  id: "claude-daily-coding",
  manifest: {
    id: "claude-daily-coding",
    targetId: "claude-code",
    name: "Claude Code Daily Coding",
    description: "Claude Code profile",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "# Claude Code instructions\n",
  configText,
  assetPolicy: {
    ownedDirs: [
      { kind: "agent", source: "agents/reviewer", targetName: "reviewer" },
      { kind: "skill", source: "skills/reviewer", targetName: "reviewer" }
    ],
    ownedFiles: [],
    skillRefs: [],
    mcpRefs: [],
    mcpSelections: [],
    disabledSkillPaths: []
  }
});

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("Claude Code target adapter", () => {
  it("reports native skillOverrides as runtime-disabled without modifying settings", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const skillDir = join(targetPaths.skillsDir ?? "", "reviewer");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "---\nname: reviewer\n---\n# Reviewer\n");
    await mkdir(targetPaths.configDir, { recursive: true });
    const settings = '{\n  // Native Claude setting\n  "skillOverrides": { "reviewer": "off" }\n}\n';
    await writeFile(targetPaths.configPath, settings, "utf8");

    const snapshot = await adapter.skills.inspectRuntime(targetPaths);

    expect(snapshot.observations).toEqual([
      expect.objectContaining({ runtimeName: "reviewer", availability: "disabled" })
    ]);
    await expect(readFile(targetPaths.configPath, "utf8")).resolves.toBe(settings);
  });

  it("plans CLAUDE.md, settings.json, and user-scope MCP overlay without clobbering unmanaged config", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.instructionsPath, "# Old Claude\n", "utf8");
    await writeFile(
      targetPaths.configPath,
      JSON.stringify(
        {
          $schema: "https://json.schemastore.org/claude-code-settings.json",
          theme: "dark",
          model: "sonnet",
          permissions: { allow: ["Bash(npm test)"] }
        },
        null,
        2
      ),
      "utf8"
    );
    await writeFile(
      targetPaths.mcpConfigPath ?? "",
      JSON.stringify(
        {
          projects: { "/repo": { allowedTools: ["Read"] } },
          mcpServers: {
            "old-managed": { type: "stdio", command: "old" },
            unmanaged: { type: "http", url: "https://example.com/mcp" }
          }
        },
        null,
        2
      ),
      "utf8"
    );

    const profile = makeProfile(
      JSON.stringify(
        {
          settings: {
            $schema: "https://json.schemastore.org/claude-code-settings.json",
            model: "opus",
            permissions: { deny: ["Read(./.env)"] }
          },
          mcpServers: {
            context7: {
              type: "http",
              url: "https://mcp.context7.com/mcp"
            }
          }
        },
        null,
        2
      )
    );
    const state: TargetState = {
      managedConfigKeys: ["model", "permissions"],
      managedMcpNames: ["old-managed"]
    };

    const preview = await adapter.createPreview({ profile, targetPaths, state });

    expect(preview.errors).toEqual([]);
    const settingsChange = preview.changes.find((change) =>
      change.path.endsWith("settings.json")
    );
    const mcpChange = preview.changes.find((change) =>
      change.path.endsWith(".claude.json")
    );
    expect(settingsChange).toBeDefined();
    expect(mcpChange).toBeUndefined();
    expect(parse(settingsChange?.after ?? "")).toMatchObject({
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      theme: "dark",
      model: "opus",
      permissions: { deny: ["Read(./.env)"] }
    });
    expect(preview.targetState).toEqual({
      managedConfigKeys: ["model", "permissions"],
      managedMcpNames: []
    });
    await expect(
      readFile(targetPaths.mcpConfigPath ?? "", "utf8")
    ).resolves.toContain("old-managed");
  });

  it("preserves previously managed native settings when the Profile has no Advanced values", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    const liveSettings = `${JSON.stringify(
      {
        permissions: { defaultMode: "bypassPermissions" },
        theme: "dark"
      },
      null,
      2
    )}\n`;
    await writeFile(targetPaths.configPath, liveSettings, "utf8");

    const profile = makeProfile(
      `${JSON.stringify(
        {
          settings: { $schema: "https://json.schemastore.org/claude-code-settings.json" },
          mcpServers: {}
        },
        null,
        2
      )}\n`
    );
    const state: TargetState = {
      managedConfigKeys: ["permissions"],
      managedMcpNames: []
    };

    const preview = await adapter.createPreview({ profile, targetPaths, state });

    expect(preview.errors).toEqual([]);
    expect(preview.changes.map((change) => change.path)).not.toContain(targetPaths.configPath);
    expect(preview.liveFingerprints).not.toHaveProperty(targetPaths.configPath);
    expect(preview.targetState).toEqual({
      managedConfigKeys: [],
      managedMcpNames: []
    });
    await expect(readFile(targetPaths.configPath, "utf8")).resolves.toBe(liveSettings);
  });

  it("reports unmanaged settings and MCP conflicts before apply", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(
      targetPaths.configPath,
      JSON.stringify({ model: "sonnet" }),
      "utf8"
    );
    await writeFile(
      targetPaths.mcpConfigPath ?? "",
      JSON.stringify({
        mcpServers: {
          context7: {
            type: "http",
            url: "https://example.com/existing"
          }
        }
      }),
      "utf8"
    );

    const profile = makeProfile(
      JSON.stringify({
        settings: { model: "opus" },
        mcpServers: {
          context7: {
            type: "http",
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
      "Config key model already exists outside AgentEnv management"
    );
    expect(preview.errors).not.toContain(
      "MCP server context7 already exists outside AgentEnv management"
    );
  });

  it("accepts semantically equal unmanaged settings with different key order", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-equal-settings-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(
      targetPaths.configPath,
      JSON.stringify({ env: { SECOND: "two", FIRST: "one" } }),
      "utf8"
    );
    const profile = makeProfile(
      JSON.stringify({ settings: { env: { FIRST: "one", SECOND: "two" } } })
    );

    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] },
      allowMatchingUnmanagedConfig: true
    });

    expect(preview.errors).toEqual([]);
  });

  it("preserves unmanaged env values omitted from a captured profile", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-partial-env-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(
      targetPaths.configPath,
      JSON.stringify({ env: { MODE: "review", ANTHROPIC_AUTH_TOKEN: "secret" } }),
      "utf8"
    );
    const profile = makeProfile(
      JSON.stringify({ settings: { env: { MODE: "review" } } })
    );

    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] },
      allowMatchingUnmanagedConfig: true
    });

    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toContain(
      "Claude Code env contains Agent-owned values and will be preserved"
    );
    expect(preview.changes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: targetPaths.configPath })])
    );
    expect(preview.targetState.managedConfigKeys).not.toContain("env");
  });

  it("does not write wrapper-only mcpServers into settings.json", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const profile = makeProfile(
      JSON.stringify({
        mcpServers: {
          docs: {
            type: "http",
            url: "https://example.com/docs"
          }
        }
      })
    );

    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    const settingsChange = preview.changes.find((change) =>
      change.path.endsWith("settings.json")
    );
    const mcpChange = preview.changes.find((change) =>
      change.path.endsWith(".claude.json")
    );
    expect(preview.errors).toEqual([]);
    expect(settingsChange).toBeUndefined();
    expect(mcpChange).toBeUndefined();
  });

  it("leaves Claude settings and MCP files outside the plan when neither surface is used", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.configPath, '{ "theme": "dark" }\n');
    await writeFile(
      targetPaths.mcpConfigPath ?? "",
      '{ "mcpServers": { "docs": { "type": "http", "url": "https://example.com" } } }\n'
    );
    const profile = makeProfile(
      '{ "settings": { "$schema": "https://json.schemastore.org/claude-code-settings.json" }, "mcpServers": {} }\n'
    );

    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([]);
    expect(preview.changes.map((change) => change.path)).not.toContain(targetPaths.configPath);
    expect(preview.changes.map((change) => change.path)).not.toContain(targetPaths.mcpConfigPath);
    expect(Object.keys(preview.liveFingerprints)).not.toContain(targetPaths.configPath);
    expect(Object.keys(preview.liveFingerprints)).not.toContain(targetPaths.mcpConfigPath);
  });

  it("does not treat an empty owner marker as permission to replace user skills", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const profileDir = join(root, "profiles", "claude-daily-coding");
    await mkdir(join(profileDir, "skills", "reviewer"), { recursive: true });
    await writeFile(join(profileDir, "skills", "reviewer", "SKILL.md"), "# Skill\n");
    const targetDir = join(targetPaths.skillsDir ?? "", "reviewer");
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(targetDir, ".agentenv-owner.json"), "{}\n");
    const profile: ProfileDetail = {
      ...makeProfile("{}"),
      profileDir,
      assetPolicy: {
        ownedDirs: [{ kind: "skill", source: "skills/reviewer", targetName: "reviewer" }],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    };

    await expect(
      adapter.validateAssets({ profile, targetPaths })
    ).resolves.toContain(
      `skill target already exists and is not AgentEnv-owned: ${targetDir}`
    );
  });

  it("links reusable library skills as whole directories for Claude Code", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-"));
    const adapter = createClaudeCodeTargetAdapter();
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
        skillRefs: [{ libraryId: "shared-reviewer", targetName: "shared-reviewer" }],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    };

    await expect(
      adapter.validateAssets({ profile, targetPaths, skillLibraryDir })
    ).resolves.toEqual([]);
    await adapter.applyAssets({
      profile,
      targetPaths,
      skillLibraryDir,
      skillSyncMethod: "symlink"
    });

    const targetDir = join(targetPaths.skillsDir ?? "", "shared-reviewer");
    expect((await lstat(targetDir)).isSymbolicLink()).toBe(true);
    await expect(readlink(targetDir)).resolves.toBe(librarySkillDir);
    await expect(readFile(join(targetDir, "references", "guide.md"), "utf8")).resolves.toBe(
      "# Guide\n"
    );
    await expect(readFile(`${targetDir}.agentenv-owner.json`, "utf8")).resolves.toContain(
      '"source": "skills-library/shared-reviewer"'
    );
  });

  it("captures portable Claude settings and excludes literal MCP credentials", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-capture-"));
    const adapter = createClaudeCodeTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.instructionsPath, "# Existing Claude\n", "utf8");
    await writeFile(
      targetPaths.configPath,
      JSON.stringify({ model: "sonnet", customHeader: "Bearer hidden-value-123" }),
      "utf8"
    );
    await writeFile(
      targetPaths.mcpConfigPath ?? "",
      JSON.stringify({
        mcpServers: {
          docs: { type: "stdio", command: "node", args: ["server.js"] },
          secret: { type: "stdio", command: "node", env: { TOKEN: "literal-secret" } },
          remoteSecret: {
            type: "http",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer hidden" }
          }
        }
      }),
      "utf8"
    );

    const captured = await adapter.captureProfile(targetPaths);
    expect(JSON.parse(captured.configText)).toMatchObject({
      settings: { model: "sonnet" }
    });
    expect(JSON.parse(captured.configText).settings).not.toHaveProperty(
      "customHeader"
    );
    expect(captured.mcpServers).toEqual([]);
    expect(
      captured.mcpConnections?.map((connection) => connection.name)
    ).toEqual(["docs", "remoteSecret", "secret"]);
    expect(
      captured.mcpConnections?.every((connection) => !connection.controllable)
    ).toBe(true);
    expect(captured.excluded).not.toContain(".claude.json.mcpServers.secret");
    expect(captured.excluded).not.toContain(
      ".claude.json.mcpServers.remoteSecret"
    );
    expect(captured.excluded).toContain("claude.settings.customHeader");
  });
});
