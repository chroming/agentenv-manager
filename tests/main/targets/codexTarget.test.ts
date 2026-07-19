import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCodexTargetAdapter } from "../../../src/main/targets/codexTarget";
import type { ProfileDetail, TargetState } from "../../../src/shared/types";

let root = "";

const makeProfile = (configText: string): ProfileDetail => ({
  id: "codex-daily-coding",
  manifest: {
    id: "codex-daily-coding",
    targetId: "codex",
    name: "Codex Daily Coding",
    description: "Codex profile",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "# Codex instructions\n",
  configText,
  assetPolicy: {
    ownedDirs: [
      { kind: "skill", source: "skills/reviewer", targetName: "agentenv-reviewer" }
    ],
    ownedFiles: [
      { kind: "agent", source: "agents/reviewer.toml", targetName: "reviewer.toml" }
    ],
    skillRefs: [],
    mcpRefs: [],
    mcpSelections: [],
    disabledSkillPaths: ["/Users/example/.agents/skills/legacy/SKILL.md"]
  }
});

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("Codex target adapter", () => {
  it("reports only Target-owned native disabled Skills", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const reviewerDir = join(targetPaths.skillsDir ?? "", "reviewer-folder");
    const managedDir = join(targetPaths.skillsDir ?? "", "managed-folder");
    await mkdir(reviewerDir, { recursive: true });
    await mkdir(managedDir, { recursive: true });
    await writeFile(join(reviewerDir, "SKILL.md"), "---\nname: reviewer\n---\n# Reviewer\n");
    await writeFile(join(managedDir, "SKILL.md"), "---\nname: managed-skill\n---\n# Managed\n");
    await writeFile(
      targetPaths.configPath,
      [
        "[[skills.config]]",
        `path = ${JSON.stringify(join(reviewerDir, "SKILL.md"))}`,
        "enabled = false",
        "",
        "# BEGIN AgentEnv Manager: skills",
        "[[skills.config]]",
        `path = ${JSON.stringify(join(managedDir, "SKILL.md"))}`,
        "enabled = false",
        "# END AgentEnv Manager: skills",
        ""
      ].join("\n")
    );

    const nativeState = await adapter.skills.readNativeState(targetPaths);
    const snapshot = await adapter.skills.inspectRuntime(targetPaths);

    expect(nativeState.disabledRuntimeNames).toEqual(["reviewer"]);
    expect(snapshot.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ runtimeName: "reviewer", availability: "disabled" }),
      expect.objectContaining({ runtimeName: "managed-skill", availability: "enabled" })
    ]));
  });

  it("uses real Codex user paths and enables guarded real writes", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({
      homeDir: root,
      fakeHomeRoot: join(root, "fake-home")
    });

    expect(adapter.descriptor.realWritesEnabled).toBe(true);
    expect(targetPaths).toMatchObject({
      configDir: join(root, ".codex"),
      instructionsPath: join(root, ".codex", "AGENTS.md"),
      configPath: join(root, ".codex", "config.toml"),
      agentsDir: join(root, ".codex", "agents"),
      skillsDir: join(root, ".codex", "skills")
    });
  });

  it("plans AGENTS.md and managed config.toml sections without touching auth.json", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.instructionsPath, "# Old Codex\n", "utf8");
    await writeFile(join(targetPaths.configDir, "auth.json"), '{"token":"keep"}\n', "utf8");
    await writeFile(
      targetPaths.configPath,
      [
        'model = "gpt-5"',
        'approval_policy = "on-request"',
        "",
        "[mcp_servers.user_docs]",
        'url = "https://example.com/user-docs"',
        "",
        "[mcp_servers.context7]",
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp"]',
        "enabled = false",
        ""
      ].join("\n"),
      "utf8"
    );

    const profile = makeProfile("");
    profile.assetPolicy.mcpSelections = [
      { targetId: "codex", name: "context7", enabled: true }
    ];
    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([]);
    expect(Object.keys(preview.liveFingerprints)).not.toContain(
      join(targetPaths.configDir, "auth.json")
    );
    const configChange = preview.changes.find((change) =>
      change.path.endsWith("config.toml")
    );
    expect(configChange?.after).toContain('model = "gpt-5"');
    expect(configChange?.after).toContain("[mcp_servers.user_docs]");
    expect(configChange?.after).toContain("[mcp_servers.context7]");
    expect(configChange?.after).toMatch(
      /\[mcp_servers\.context7\][\s\S]*enabled = true/
    );
    expect(configChange?.after).toContain("[[skills.config]]");
    expect(configChange?.after).toContain(
      'path = "/Users/example/.agents/skills/legacy/SKILL.md"'
    );
  });

  it("controls an existing native MCP without replacing its definition", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(
      targetPaths.configPath,
      '[mcp_servers.context7]\ncommand = "old"\n',
      "utf8"
    );

    const profile = makeProfile('[mcp_servers.context7]\ncommand = "new"\n');
    profile.assetPolicy.mcpSelections = [
      { targetId: "codex", name: "context7", enabled: false }
    ];
    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([]);
    const configChange = preview.changes.find(
      (change) => change.path === targetPaths.configPath
    );
    expect(configChange?.after).toContain('command = "old"');
    expect(configChange?.after).not.toContain('command = "new"');
    expect(configChange?.after).toContain("enabled = false");
  });

  it("leaves config.toml outside the plan when the Profile has no MCP or Skill settings", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.configPath, 'model = "gpt-5"\n# user-owned config\n');
    const profile = {
      ...makeProfile(""),
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [],
        mcpRefs: [],
        disabledSkillPaths: []
      }
    };

    const preview = await adapter.createPreview({
      profile,
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    expect(preview.errors).toEqual([]);
    expect(preview.changes.map((change) => change.path)).not.toContain(targetPaths.configPath);
    expect(Object.keys(preview.liveFingerprints)).not.toContain(targetPaths.configPath);
  });

  it("copies owned Codex skills and custom agent files with strict ownership", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const profileDir = join(root, "profiles", "codex-daily-coding");
    await mkdir(join(profileDir, "skills", "reviewer"), { recursive: true });
    await mkdir(join(profileDir, "agents"), { recursive: true });
    await writeFile(join(profileDir, "skills", "reviewer", "SKILL.md"), "# Skill\n");
    await writeFile(
      join(profileDir, "agents", "reviewer.toml"),
      'name = "reviewer"\ndescription = "Review code."\ndeveloper_instructions = "Review carefully."\n',
      "utf8"
    );
    const profile = { ...makeProfile(""), profileDir };

    await expect(adapter.validateAssets({ profile, targetPaths })).resolves.toEqual([]);
    await adapter.applyAssets({ profile, targetPaths });

    await expect(
      readFile(join(targetPaths.skillsDir ?? "", "agentenv-reviewer", "SKILL.md"), "utf8")
    ).resolves.toBe("# Skill\n");
    await expect(
      readFile(join(targetPaths.agentsDir ?? "", "reviewer.toml"), "utf8")
    ).resolves.toContain('name = "reviewer"');
    await expect(
      readFile(
        join(targetPaths.agentsDir ?? "", "reviewer.toml.agentenv-owner.json"),
        "utf8"
      )
    ).resolves.toContain('"kind": "agent"');
  });

  it("links reusable library skills as whole directories for Codex", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    const skillLibraryDir = join(root, "app-data", "skills-library");
    const librarySkillDir = join(skillLibraryDir, "shared-reviewer");
    await mkdir(join(librarySkillDir, "references"), { recursive: true });
    await writeFile(join(librarySkillDir, "SKILL.md"), "# Shared reviewer\n");
    await writeFile(join(librarySkillDir, "references", "guide.md"), "# Guide\n");
    const profile: ProfileDetail = {
      ...makeProfile(""),
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [{ libraryId: "shared-reviewer", targetName: "agentenv-shared-reviewer" }],
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

    const targetDir = join(targetPaths.skillsDir ?? "", "agentenv-shared-reviewer");
    expect((await lstat(targetDir)).isSymbolicLink()).toBe(true);
    await expect(readlink(targetDir)).resolves.toBe(librarySkillDir);
    await expect(readFile(join(targetDir, "references", "guide.md"), "utf8")).resolves.toBe(
      "# Guide\n"
    );
    await expect(readFile(`${targetDir}.agentenv-owner.json`, "utf8")).resolves.toContain(
      '"source": "skills-library/shared-reviewer"'
    );
  });

  it("captures portable Codex MCP and disabled skills while excluding native settings", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-capture-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(targetPaths.instructionsPath, "# Existing Codex\n", "utf8");
    await writeFile(
      targetPaths.configPath,
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.docs]",
        'command = "node"',
        'args = ["server.js"]',
        'env_vars = ["DOCS_TOKEN"]',
        "",
        "[[skills.config]]",
        'path = "/tmp/disabled/SKILL.md"',
        "enabled = false",
        ""
      ].join("\n"),
      "utf8"
    );

    const captured = await adapter.captureProfile(targetPaths);
    expect(captured.instructions).toBe("# Existing Codex\n");
    expect(captured.configText).toBe("");
    expect(captured.mcpServers).toEqual([]);
    expect(captured.mcpConnections).toEqual([
      expect.objectContaining({
        name: "docs",
        targetId: "codex",
        enabled: true,
        controllable: true,
        transport: "stdio"
      })
    ]);
    expect(captured.disabledSkillPaths).toEqual(["/tmp/disabled/SKILL.md"]);
    expect(captured.excluded).toContain("config.toml.model");
  });
});
