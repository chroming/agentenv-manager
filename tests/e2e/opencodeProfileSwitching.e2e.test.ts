import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createBackupStore } from "../../src/main/backupStore";
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

const fileExists = async (path: string) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const readJsonc = async (path: string) =>
  parse(await readFile(path, "utf8")) as Record<string, unknown>;

const makeEnv = async (): Promise<E2EEnv> => {
  root = await mkdtemp(join(tmpdir(), "agentenv-opencode-e2e-"));
  const binDir = join(root, "bin");
  const homeDir = join(root, "home");
  const appDataRoot = join(root, "app-data");
  const fakeHomeRoot = join(root, "fake-home");
  await mkdir(binDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  const executable = join(binDir, "opencode");
  await writeFile(executable, "#!/bin/sh\necho fake-opencode\n", "utf8");
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

const createOpenCodeProfile = async (
  profileStore: ProfileStore,
  variant: "alpha" | "beta"
): Promise<ProfileDetail> => {
  const profile = await profileStore.saveProfile({
    manifest: {
      id: `opencode-${variant}`,
      targetId: "opencode",
      name: `OpenCode ${variant}`,
      description: `Temporary ${variant} profile`,
      version: 1,
      managed: { instructions: true, config: true, assets: true }
    },
    instructions: `# ${variant.toUpperCase()} Instructions\n\n- Active profile: ${variant}.\n`,
    configText: `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        username: `agentenv-${variant}`,
        permission: {
          edit: variant === "alpha" ? "deny" : "ask"
        },
        mcp: {
          [`agentenv-${variant}-mcp`]: {
            type: "local",
            command: ["node", "--version"],
            enabled: true
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
      disabledSkillPaths: []
    }
  });

  await mkdir(join(profile.profileDir ?? "", "agents", `agentenv-${variant}-agent`), {
    recursive: true
  });
  await writeFile(
    join(profile.profileDir ?? "", "agents", `agentenv-${variant}-agent`, "agent.md"),
    `---\nname: agentenv-${variant}-agent\ndescription: ${variant} switching test agent.\nmode: subagent\npermission:\n  edit: deny\n---\n\n${variant} agent prompt.\n`,
    "utf8"
  );
  await mkdir(join(profile.profileDir ?? "", "skills", `agentenv-${variant}-skill`), {
    recursive: true
  });
  await writeFile(
    join(profile.profileDir ?? "", "skills", `agentenv-${variant}-skill`, "SKILL.md"),
    `---\nname: agentenv-${variant}-skill\ndescription: Use when verifying ${variant} AgentEnv OpenCode switching.\n---\n\n# ${variant} skill\n`,
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

describe("OpenCode profile switching e2e", () => {
  it("switches active instructions, MCP config, agents, and skills between profiles", async () => {
    const { paths, profileStore, activationService, listTargets } = await makeEnv();
    const targetDir = join(paths.homeDir, ".config", "opencode");
    await mkdir(targetDir, { recursive: true });
    await writeFile(
      join(targetDir, "opencode.json"),
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          shell: "/bin/zsh",
          mcp: {
            "user-managed": {
              type: "remote",
              url: "https://example.com/mcp"
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n", "utf8");

    const alpha = await createOpenCodeProfile(profileStore, "alpha");
    const beta = await createOpenCodeProfile(profileStore, "beta");

    await expectApplyOk(activationService, alpha.id);
    const alphaConfig = await readJsonc(join(targetDir, "opencode.json"));
    expect(await readFile(join(targetDir, "AGENTS.md"), "utf8")).toContain(
      "Active profile: alpha"
    );
    expect(alphaConfig).toMatchObject({
      shell: "/bin/zsh",
      username: "agentenv-alpha",
      permission: { edit: "deny" },
      mcp: {
        "user-managed": { type: "remote", url: "https://example.com/mcp" },
        "agentenv-alpha-mcp": {
          type: "local",
          command: ["node", "--version"],
          enabled: true
        }
      }
    });
    await expect(
      fileExists(join(targetDir, "agents", "agentenv-alpha-agent", "agent.md"))
    ).resolves.toBe(true);
    await expect(
      fileExists(join(targetDir, "skills", "agentenv-alpha-skill", "SKILL.md"))
    ).resolves.toBe(true);

    await expectApplyOk(activationService, beta.id);
    const betaConfig = await readJsonc(join(targetDir, "opencode.json"));
    const backups = await createBackupStore(paths).listBackups();
    const targets = await listTargets();
    const opencode = targets.find((target) => target.id === "opencode");

    expect(opencode?.health.status).toBe("ready");
    expect(opencode?.health.canWrite).toBe(true);
    expect(backups).toHaveLength(2);
    expect(await readFile(join(targetDir, "AGENTS.md"), "utf8")).toContain(
      "Active profile: beta"
    );
    expect(betaConfig).toMatchObject({
      shell: "/bin/zsh",
      username: "agentenv-beta",
      permission: { edit: "ask" },
      mcp: {
        "user-managed": { type: "remote", url: "https://example.com/mcp" },
        "agentenv-beta-mcp": {
          type: "local",
          command: ["node", "--version"],
          enabled: true
        }
      }
    });
    expect((betaConfig.mcp as Record<string, unknown>)["agentenv-alpha-mcp"]).toBeUndefined();
    await expect(
      fileExists(join(targetDir, "agents", "agentenv-alpha-agent"))
    ).resolves.toBe(false);
    await expect(
      fileExists(join(targetDir, "skills", "agentenv-alpha-skill"))
    ).resolves.toBe(false);
    await expect(
      readFile(join(targetDir, "agents", "agentenv-beta-agent", "agent.md"), "utf8")
    ).resolves.toContain("beta agent prompt");
    await expect(
      readFile(join(targetDir, "skills", "agentenv-beta-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("name: agentenv-beta-skill");
  });

  it("blocks a profile switch when the target has an unmanaged MCP conflict", async () => {
    const { paths, profileStore, activationService } = await makeEnv();
    const targetDir = join(paths.homeDir, ".config", "opencode");
    const alpha = await createOpenCodeProfile(profileStore, "alpha");
    const beta = await createOpenCodeProfile(profileStore, "beta");
    await expectApplyOk(activationService, alpha.id);

    const liveConfig = await readJsonc(join(targetDir, "opencode.json"));
    await writeFile(
      join(targetDir, "opencode.json"),
      `${JSON.stringify(
        {
          ...liveConfig,
          mcp: {
            ...(liveConfig.mcp as Record<string, unknown>),
            "agentenv-beta-mcp": {
              type: "remote",
              url: "https://example.com/user-beta"
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const preview = await activationService.previewProfile(beta.id);
    expect(preview.errors).toContain(
      "MCP server agentenv-beta-mcp already exists outside AgentEnv management"
    );
    const result = await activationService.applyProfile(beta.id, preview.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "MCP server agentenv-beta-mcp already exists outside AgentEnv management"
      );
    }
    const configAfterBlockedSwitch = await readJsonc(join(targetDir, "opencode.json"));
    expect(await readFile(join(targetDir, "AGENTS.md"), "utf8")).toContain(
      "Active profile: alpha"
    );
    expect(configAfterBlockedSwitch).toMatchObject({
      username: "agentenv-alpha",
      mcp: {
        "agentenv-alpha-mcp": {
          type: "local",
          command: ["node", "--version"],
          enabled: true
        },
        "agentenv-beta-mcp": {
          type: "remote",
          url: "https://example.com/user-beta"
        }
      }
    });
    await expect(
      fileExists(join(targetDir, "agents", "agentenv-alpha-agent"))
    ).resolves.toBe(true);
    await expect(
      fileExists(join(targetDir, "skills", "agentenv-alpha-skill"))
    ).resolves.toBe(true);
    await expect(
      fileExists(join(targetDir, "agents", "agentenv-beta-agent"))
    ).resolves.toBe(false);
    await expect(
      fileExists(join(targetDir, "skills", "agentenv-beta-skill"))
    ).resolves.toBe(false);
  });

  it("rolls back a profile switch including owned agents and skills", async () => {
    const { paths, profileStore, activationService } = await makeEnv();
    const targetDir = join(paths.homeDir, ".config", "opencode");
    await mkdir(targetDir, { recursive: true });
    await writeFile(
      join(targetDir, "opencode.json"),
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          shell: "/bin/zsh",
          mcp: {
            "user-managed": {
              type: "remote",
              url: "https://example.com/mcp"
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    await writeFile(join(targetDir, "AGENTS.md"), "# Existing OpenCode\n", "utf8");

    const alpha = await createOpenCodeProfile(profileStore, "alpha");
    const beta = await createOpenCodeProfile(profileStore, "beta");
    await expectApplyOk(activationService, alpha.id);
    const betaApply = await expectApplyOk(activationService, beta.id);
    if (!betaApply.ok) {
      throw new Error("Expected beta apply to succeed");
    }

    const rollbackPreview = await activationService.previewRollback(betaApply.backupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect(rollbackPreview.changes.map((change) => change.path)).toEqual(
      expect.arrayContaining([
        join(targetDir, "AGENTS.md"),
        join(targetDir, "opencode.json"),
        join(targetDir, "agents", "agentenv-alpha-agent"),
        join(targetDir, "skills", "agentenv-alpha-skill"),
        join(targetDir, "agents", "agentenv-beta-agent"),
        join(targetDir, "skills", "agentenv-beta-skill")
      ])
    );

    const rollbackResult = await activationService.rollback(betaApply.backupId);
    expect(rollbackResult.ok).toBe(true);

    const rolledBackConfig = await readJsonc(join(targetDir, "opencode.json"));
    expect(await readFile(join(targetDir, "AGENTS.md"), "utf8")).toContain(
      "Active profile: alpha"
    );
    expect(rolledBackConfig).toMatchObject({
      shell: "/bin/zsh",
      username: "agentenv-alpha",
      permission: { edit: "deny" },
      mcp: {
        "user-managed": { type: "remote", url: "https://example.com/mcp" },
        "agentenv-alpha-mcp": {
          type: "local",
          command: ["node", "--version"],
          enabled: true
        }
      }
    });
    expect(
      (rolledBackConfig.mcp as Record<string, unknown>)["agentenv-beta-mcp"]
    ).toBeUndefined();
    await expect(
      readFile(join(targetDir, "agents", "agentenv-alpha-agent", "agent.md"), "utf8")
    ).resolves.toContain("alpha agent prompt");
    await expect(
      readFile(join(targetDir, "skills", "agentenv-alpha-skill", "SKILL.md"), "utf8")
    ).resolves.toContain("name: agentenv-alpha-skill");
    await expect(
      fileExists(join(targetDir, "agents", "agentenv-beta-agent"))
    ).resolves.toBe(false);
    await expect(
      fileExists(join(targetDir, "skills", "agentenv-beta-skill"))
    ).resolves.toBe(false);
  });
});
