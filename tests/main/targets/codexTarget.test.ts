import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      skillsDir: join(root, ".agents", "skills")
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
        ""
      ].join("\n"),
      "utf8"
    );

    const profile = makeProfile(
      [
        "[mcp_servers.context7]",
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp"]',
        ""
      ].join("\n")
    );
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
    expect(configChange?.after).toContain("[[skills.config]]");
    expect(configChange?.after).toContain(
      'path = "/Users/example/.agents/skills/legacy/SKILL.md"'
    );
  });

  it("reports unmanaged MCP conflicts before apply", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-"));
    const adapter = createCodexTargetAdapter();
    const targetPaths = adapter.createTargetPaths({ homeDir: root });
    await mkdir(targetPaths.configDir, { recursive: true });
    await writeFile(
      targetPaths.configPath,
      '[mcp_servers.context7]\ncommand = "old"\n',
      "utf8"
    );

    const preview = await adapter.createPreview({
      profile: makeProfile('[mcp_servers.context7]\ncommand = "new"\n'),
      targetPaths,
      state: { managedConfigKeys: [], managedMcpNames: [] }
    });

    expect(preview.errors).toContain(
      "MCP server context7 already exists outside AgentEnv-managed section"
    );
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
});
