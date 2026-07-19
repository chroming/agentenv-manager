import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
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

const readJsonc = async (path: string) =>
  parse(await readFile(path, "utf8")) as Record<string, unknown>;

const makeEnv = async (): Promise<E2EEnv> => {
  root = await mkdtemp(join(tmpdir(), "agentenv-claude-e2e-"));
  const binDir = join(root, "bin");
  const homeDir = join(root, "home");
  const appDataRoot = join(root, "app-data");
  const fakeHomeRoot = join(root, "fake-home");
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  const executable = join(binDir, "claude");
  await writeFile(executable, "#!/bin/sh\necho fake-claude\n", "utf8");
  await chmod(executable, 0o755);

  const paths = createPaths({ appDataRoot, homeDir, fakeHomeRoot });
  const targetRegistry = createTargetRegistry();
  const profileStore = createProfileStore(
    { appDataRoot, homeDir, fakeHomeRoot },
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

const createClaudeProfile = async (
  profileStore: ProfileStore,
  variant: "alpha" | "beta"
): Promise<ProfileDetail> => {
  const profile = await profileStore.saveProfile({
    manifest: {
      id: `claude-${variant}`,
      targetId: "claude-code",
      name: `Claude Code ${variant}`,
      description: `Temporary ${variant} Claude Code profile`,
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    },
    instructions: `# ${variant.toUpperCase()} Claude Instructions\n\n- Active profile: ${variant}.\n`,
    configText: `${JSON.stringify(
      {
        settings: {
          $schema: "https://json.schemastore.org/claude-code-settings.json",
          model: variant === "alpha" ? "sonnet" : "opus",
          permissions: {
            deny: variant === "alpha" ? ["Read(./alpha.env)"] : ["Read(./beta.env)"]
          }
        }
      },
      null,
      2
    )}\n`,
    assetPolicy: {
      ownedDirs: [
        {
          kind: "agent",
          source: `agents/agentenv-${variant}-agent`,
          targetName: `agentenv-${variant}-agent`
        },
        {
          kind: "skill",
          source: `skills/agentenv-${variant}-skill`,
          targetName: `agentenv-${variant}-skill`
        }
      ],
      ownedFiles: [],
      skillRefs: [],
      mcpRefs: [],
      mcpSelections: [
        {
          targetId: "claude-code",
          name: "user-managed",
          enabled: variant === "alpha"
        }
      ],
      disabledSkillPaths: []
    }
  });

  await mkdir(join(profile.profileDir ?? "", "agents", `agentenv-${variant}-agent`), {
    recursive: true
  });
  await writeFile(
    join(profile.profileDir ?? "", "agents", `agentenv-${variant}-agent`, "agent.md"),
    `---\ndescription: ${variant} Claude Code switching test agent.\n---\n\n${variant} agent prompt.\n`,
    "utf8"
  );
  await mkdir(join(profile.profileDir ?? "", "skills", `agentenv-${variant}-skill`), {
    recursive: true
  });
  await writeFile(
    join(profile.profileDir ?? "", "skills", `agentenv-${variant}-skill`, "SKILL.md"),
    `---\ndescription: Use when verifying ${variant} AgentEnv Claude Code switching.\n---\n\n# ${variant} skill\n`,
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

describe("Claude Code profile switching e2e", () => {
  it("blocks a Profile Skill disabled by native Claude Code settings", async () => {
    const { paths, profileStore, activationService } = await makeEnv();
    const claudeDir = join(paths.homeDir, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    await mkdir(claudeDir, { recursive: true });
    const settings = '{\n  "skillOverrides": { "agentenv-alpha-skill": "off" }\n}\n';
    await writeFile(settingsPath, settings, "utf8");
    const profile = await createClaudeProfile(profileStore, "alpha");

    const preview = await activationService.previewProfile(profile.id);

    expect(preview.errors).toContain(
      "Claude Code has Skill agentenv-alpha-skill disabled in native settings; enable it there before applying this Profile"
    );
    await expect(readFile(settingsPath, "utf8")).resolves.toBe(settings);
  });

  it("switches managed resources while leaving Claude-owned MCP definitions untouched", async () => {
    const { paths, profileStore, activationService, listTargets } =
      await makeEnv();
    const claudeDir = join(paths.homeDir, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    const mcpPath = join(paths.homeDir, ".claude.json");
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      settingsPath,
      `${JSON.stringify(
        {
          theme: "dark",
          cleanupPeriodDays: 20
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(
      mcpPath,
      `${JSON.stringify(
        {
          projects: { "/repo": { allowedTools: ["Read"] } },
          mcpServers: {
            "user-managed": {
              type: "http",
              url: "https://example.com/user/mcp",
              headers: { Authorization: "Bearer private" }
            },
            "agentenv-alpha-mcp": {
              type: "http",
              url: "https://example.com/alpha/mcp"
            },
            "agentenv-beta-mcp": {
              type: "http",
              url: "https://example.com/beta/mcp"
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(join(claudeDir, "CLAUDE.md"), "# Existing Claude\n", "utf8");

    const alpha = await createClaudeProfile(profileStore, "alpha");
    const beta = await createClaudeProfile(profileStore, "beta");

    const readOnlyPreview = await activationService.previewProfile(alpha.id);
    expect(readOnlyPreview.effectivePayload).toMatchObject({
      mcpServers: 0,
      observedMcpServers: 1
    });
    await expectApplyOk(activationService, alpha.id);
    const betaApply = await expectApplyOk(activationService, beta.id);
    if (!betaApply.ok) {
      throw new Error("Expected beta apply to succeed");
    }
    const targets = await listTargets();
    const claude = targets.find((target) => target.id === "claude-code");
    const betaSettings = await readJsonc(settingsPath);
    const betaMcp = await readJsonc(mcpPath);

    expect(claude?.health.status).toBe("ready");
    expect(claude?.health.canWrite).toBe(true);
    expect(await readFile(join(claudeDir, "CLAUDE.md"), "utf8")).toContain(
      "Active profile: beta"
    );
    expect(betaSettings).toMatchObject({
      theme: "dark",
      cleanupPeriodDays: 20,
      model: "opus",
      permissions: { deny: ["Read(./beta.env)"] }
    });
    expect(betaMcp).toEqual(await readJsonc(mcpPath));
    expect(betaMcp.mcpServers).toMatchObject({
      "user-managed": {
        type: "http",
        url: "https://example.com/user/mcp",
        headers: { Authorization: "Bearer private" }
      },
      "agentenv-alpha-mcp": { url: "https://example.com/alpha/mcp" },
      "agentenv-beta-mcp": { url: "https://example.com/beta/mcp" }
    });
    await expect(
      readFile(join(claudeDir, "agents", "agentenv-beta-agent", "agent.md"), "utf8")
    ).resolves.toContain("beta agent prompt");
    await expect(
      readFile(join(claudeDir, "skills", "agentenv-beta-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("beta skill");

    const rollbackPreview = await activationService.previewRollback(betaApply.backupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect(rollbackPreview.changes.map((change) => change.path)).toEqual(
      expect.arrayContaining([
        join(claudeDir, "CLAUDE.md"),
        settingsPath,
        join(claudeDir, "agents", "agentenv-alpha-agent"),
        join(claudeDir, "skills", "agentenv-alpha-skill"),
        join(claudeDir, "agents", "agentenv-beta-agent"),
        join(claudeDir, "skills", "agentenv-beta-skill")
      ])
    );

    const rollbackResult = await activationService.rollback(betaApply.backupId);
    expect(rollbackResult.ok).toBe(true);
    const alphaSettings = await readJsonc(settingsPath);
    const alphaMcp = await readJsonc(mcpPath);

    expect(await readFile(join(claudeDir, "CLAUDE.md"), "utf8")).toContain(
      "Active profile: alpha"
    );
    expect(alphaSettings).toMatchObject({
      theme: "dark",
      cleanupPeriodDays: 20,
      model: "sonnet",
      permissions: { deny: ["Read(./alpha.env)"] }
    });
    expect(alphaMcp).toEqual(betaMcp);
    await expect(
      readFile(join(claudeDir, "agents", "agentenv-alpha-agent", "agent.md"), "utf8")
    ).resolves.toContain("alpha agent prompt");
    await expect(
      readFile(join(claudeDir, "skills", "agentenv-alpha-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("alpha skill");
    await expect(
      readFile(join(claudeDir, "agents", "agentenv-beta-agent", "agent.md"), "utf8")
    ).rejects.toThrow();
    await expect(
      readFile(join(claudeDir, "skills", "agentenv-beta-skill", "SKILL.md"), "utf8")
    ).rejects.toThrow();
  });
});
