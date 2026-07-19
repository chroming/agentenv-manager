import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths, type AgentEnvPaths } from "../../src/main/paths";
import { createProfileStore, type ProfileStore } from "../../src/main/profileStore";
import { createTargetDiscoveryService } from "../../src/main/targetDiscovery";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { ActivationService } from "../../src/main/activationService";
import type { ProfileDetail, TargetInfo } from "../../src/shared/types";

interface E2EEnv {
  paths: AgentEnvPaths;
  profileStore: ProfileStore;
  activationService: ActivationService;
  listTargets(): Promise<TargetInfo[]>;
}

let root = "";

const makeEnv = async (): Promise<E2EEnv> => {
  root = await mkdtemp(join(tmpdir(), "agentenv-codex-e2e-"));
  const binDir = join(root, "bin");
  const homeDir = join(root, "home");
  const appDataRoot = join(root, "app-data");
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  const executable = join(binDir, "codex");
  await writeFile(executable, "#!/bin/sh\necho fake-codex\n", "utf8");
  await chmod(executable, 0o755);

  const paths = createPaths({ appDataRoot, homeDir, fakeHomeRoot: join(root, "fake-home") });
  const targetRegistry = createTargetRegistry();
  const profileStore = createProfileStore(
    { appDataRoot, homeDir, fakeHomeRoot: paths.fakeHomeRoot },
    targetRegistry
  );
  const activationService = createActivationService({
    paths,
    profileStore,
    targetRegistry
  });
  const targetDiscoveryService = createTargetDiscoveryService({
    paths,
    targetRegistry,
    pathEnv: binDir
  });

  return {
    paths,
    profileStore,
    activationService,
    listTargets: () => targetDiscoveryService.listTargets()
  };
};

const createCodexProfile = async (
  profileStore: ProfileStore,
  variant: "alpha" | "beta"
): Promise<ProfileDetail> => {
  const profile = await profileStore.saveProfile({
    manifest: {
      id: `codex-${variant}`,
      targetId: "codex",
      name: `Codex ${variant}`,
      description: `Temporary ${variant} Codex profile`,
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    },
    instructions: `# ${variant.toUpperCase()} Codex Instructions\n\n- Active profile: ${variant}.\n`,
    configText: "",
    assetPolicy: {
      ownedDirs: [
        {
          kind: "skill",
          source: `skills/agentenv-${variant}-skill`,
          targetName: `agentenv-${variant}-skill`
        }
      ],
      ownedFiles: [
        {
          kind: "agent",
          source: `agents/agentenv-${variant}-agent.toml`,
          targetName: `agentenv-${variant}-agent.toml`
        }
      ],
      skillRefs: [],
      mcpRefs: [],
      mcpSelections: [
        {
          targetId: "codex",
          name: "agentenv-alpha-mcp",
          enabled: variant === "alpha"
        },
        {
          targetId: "codex",
          name: "agentenv-beta-mcp",
          enabled: variant === "beta"
        }
      ],
      disabledSkillPaths: []
    }
  });

  await mkdir(join(profile.profileDir ?? "", "skills", `agentenv-${variant}-skill`), {
    recursive: true
  });
  await writeFile(
    join(profile.profileDir ?? "", "skills", `agentenv-${variant}-skill`, "SKILL.md"),
    `---\nname: agentenv-${variant}-skill\ndescription: Use when verifying ${variant} AgentEnv Codex switching.\n---\n\n# ${variant} skill\n`,
    "utf8"
  );
  await mkdir(join(profile.profileDir ?? "", "agents"), { recursive: true });
  await writeFile(
    join(profile.profileDir ?? "", "agents", `agentenv-${variant}-agent.toml`),
    [
      `name = "agentenv-${variant}-agent"`,
      `description = "${variant} Codex switching test agent."`,
      `developer_instructions = "${variant} agent prompt."`,
      ""
    ].join("\n"),
    "utf8"
  );

  return profile;
};

const expectApplyOk = async (
  activationService: ActivationService,
  profileId: string
) => {
  const preview = await activationService.previewProfile(profileId);
  expect(preview.errors).toEqual([]);
  const result = await activationService.applyProfile(profileId, preview.id);
  expect(result.ok).toBe(true);
  return result;
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("Codex profile switching e2e", () => {
  it("blocks a Profile Skill disabled by Codex runtime name", async () => {
    const { paths, profileStore, activationService } = await makeEnv();
    const codexDir = join(paths.homeDir, ".codex");
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, "AGENTS.md"), "# Existing Codex\n", "utf8");
    await writeFile(
      join(codexDir, "config.toml"),
      [
        "[[skills.config]]",
        'name = "agentenv-alpha-skill"',
        "enabled = false",
        ""
      ].join("\n"),
      "utf8"
    );
    const profile = await createCodexProfile(profileStore, "alpha");

    const preview = await activationService.previewProfile(profile.id, "codex");

    expect(preview.errors).toContain(
      "Codex has Skill agentenv-alpha-skill disabled in native settings; enable it there before applying this Profile"
    );
  });

  it("switches native MCP activation and managed resources while preserving definitions and auth", async () => {
    const { paths, profileStore, activationService, listTargets } =
      await makeEnv();
    const codexDir = join(paths.homeDir, ".codex");
    const configPath = join(codexDir, "config.toml");
    const authPath = join(codexDir, "auth.json");
    await mkdir(codexDir, { recursive: true });
    await writeFile(join(codexDir, "AGENTS.md"), "# Existing Codex\n", "utf8");
    await writeFile(authPath, '{"token":"never-touch"}\n', "utf8");
    await writeFile(
      configPath,
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.user_docs]",
        'url = "https://example.com/user-docs"',
        "",
        "[mcp_servers.agentenv-alpha-mcp]",
        'url = "https://example.com/alpha/mcp"',
        "enabled = false",
        "",
        "[mcp_servers.agentenv-beta-mcp]",
        'url = "https://example.com/beta/mcp"',
        'bearer_token_env_var = "MCP_TOKEN"',
        "enabled = false",
        ""
      ].join("\n"),
      "utf8"
    );

    const alpha = await createCodexProfile(profileStore, "alpha");
    const beta = await createCodexProfile(profileStore, "beta");

    await expectApplyOk(activationService, alpha.id);
    const betaApply = await expectApplyOk(activationService, beta.id);
    if (!betaApply.ok) {
      throw new Error("Expected beta apply to succeed");
    }

    const targets = await listTargets();
    const codex = targets.find((target) => target.id === "codex");
    const betaConfig = await readFile(configPath, "utf8");

    expect(codex?.health.status).toBe("ready");
    expect(codex?.health.canWrite).toBe(true);
    expect(await readFile(join(codexDir, "AGENTS.md"), "utf8")).toContain(
      "Active profile: beta"
    );
    expect(betaConfig).toContain('model = "gpt-5"');
    expect(betaConfig).toContain("[mcp_servers.user_docs]");
    expect(betaConfig).toContain("[mcp_servers.agentenv-beta-mcp]");
    expect(betaConfig).toContain("[mcp_servers.agentenv-alpha-mcp]");
    expect(betaConfig).toMatch(
      /\[mcp_servers\.agentenv-alpha-mcp\][\s\S]*?enabled = false/
    );
    expect(betaConfig).toMatch(
      /\[mcp_servers\.agentenv-beta-mcp\][\s\S]*?enabled = true/
    );
    expect(betaConfig).toContain('bearer_token_env_var = "MCP_TOKEN"');
    await expect(readFile(authPath, "utf8")).resolves.toBe(
      '{"token":"never-touch"}\n'
    );
    await expect(
      readFile(join(codexDir, "skills", "agentenv-beta-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("beta skill");
    await expect(
      readFile(join(codexDir, "agents", "agentenv-beta-agent.toml"), "utf8")
    ).resolves.toContain("beta agent prompt");

    const rollbackPreview = await activationService.previewRollback(betaApply.backupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect(rollbackPreview.changes.map((change) => change.path)).toEqual(
      expect.arrayContaining([
        join(codexDir, "AGENTS.md"),
        configPath,
        join(codexDir, "skills", "agentenv-alpha-skill"),
        join(codexDir, "skills", "agentenv-beta-skill"),
        join(codexDir, "agents", "agentenv-alpha-agent.toml"),
        join(codexDir, "agents", "agentenv-beta-agent.toml")
      ])
    );

    const rollbackResult = await activationService.rollback(betaApply.backupId);
    expect(rollbackResult.ok).toBe(true);
    const alphaConfig = await readFile(configPath, "utf8");
    expect(await readFile(join(codexDir, "AGENTS.md"), "utf8")).toContain(
      "Active profile: alpha"
    );
    expect(alphaConfig).toContain("[mcp_servers.agentenv-alpha-mcp]");
    expect(alphaConfig).toContain("[mcp_servers.agentenv-beta-mcp]");
    expect(alphaConfig).toMatch(
      /\[mcp_servers\.agentenv-alpha-mcp\][\s\S]*?enabled = true/
    );
    expect(alphaConfig).toMatch(
      /\[mcp_servers\.agentenv-beta-mcp\][\s\S]*?enabled = false/
    );
    await expect(readFile(authPath, "utf8")).resolves.toBe(
      '{"token":"never-touch"}\n'
    );
    await expect(
      readFile(join(codexDir, "agents", "agentenv-alpha-agent.toml"), "utf8")
    ).resolves.toContain("alpha agent prompt");
    await expect(
      readFile(join(codexDir, "agents", "agentenv-beta-agent.toml"), "utf8")
    ).rejects.toThrow();
  });
});
