import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createTargetRegistry } from "../../src/main/targets/registry";
import type { AgentTargetAdapter } from "../../src/main/targets/types";

let root = "";

const makeEnv = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-apply-"));
  const codexHome = join(root, ".codex");
  const userSkillsDir = join(root, ".agents", "skills");
  await mkdir(codexHome, { recursive: true });
  await mkdir(userSkillsDir, { recursive: true });
  const paths = createPaths({ appDataRoot: root, codexHome, userSkillsDir });

  const profileDir = join(paths.profilesDir, "daily-coding");
  await mkdir(join(profileDir, "skills", "example-skill"), { recursive: true });
  await writeFile(
    join(profileDir, "profile.json"),
    JSON.stringify({
      id: "daily-coding",
      name: "Daily Coding",
      description: "Default",
      version: 1,
      managed: { agents: true, mcp: true, skills: true }
    })
  );
  await writeFile(join(profileDir, "AGENTS.md"), "# New agents\n");
  await writeFile(
    join(profileDir, "mcp.toml"),
    '[mcp_servers.context7]\ncommand = "npx"\n'
  );
  await writeFile(
    join(profileDir, "skills.json"),
    JSON.stringify({
      ownedSkillDirs: [
        {
          source: "skills/example-skill",
          targetName: "agentenv-daily-coding-example-skill"
        }
      ],
      disabledSkillPaths: ["/Users/example/.agents/skills/old/SKILL.md"]
    })
  );
  await writeFile(
    join(profileDir, "skills", "example-skill", "SKILL.md"),
    "---\nname: example\n---\n"
  );

  const profileStore = createProfileStore({
    appDataRoot: paths.appDataRoot,
    codexHome: paths.codexHome,
    userSkillsDir: paths.userSkillsDir
  });
  const service = createActivationService({ paths, profileStore });

  return { paths, service };
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("activation service", () => {
  it("applies a profile, creates a backup, and copies owned skills", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n# keep me\n');

    const preview = await service.previewProfile("daily-coding");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result.ok).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# New agents\n"
    );
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain(
      "# keep me"
    );
    await expect(readFile(paths.codexConfigPath, "utf8")).resolves.toContain(
      "[mcp_servers.context7]"
    );
    await expect(
      readFile(
        join(
          paths.userSkillsDir,
          "agentenv-daily-coding-example-skill",
          "SKILL.md"
        ),
        "utf8"
      )
    ).resolves.toContain("name: example");

    const backups = await createBackupStore(paths).listBackups();
    expect(backups).toHaveLength(1);
  });

  it("refuses stale previews without writing", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");

    const preview = await service.previewProfile("daily-coding");
    await writeFile(paths.globalAgentsPath, "# Changed elsewhere\n");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result).toEqual({
      ok: false,
      errors: [`Live file changed after preview: ${paths.globalAgentsPath}`]
    });
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Changed elsewhere\n"
    );
  });

  it("reports missing owned asset sources during preview", async () => {
    const { paths, service } = await makeEnv();
    await rm(join(paths.profilesDir, "daily-coding", "skills", "example-skill"), {
      recursive: true,
      force: true
    });

    const preview = await service.previewProfile("daily-coding");

    expect(preview.errors[0]).toContain("Owned skill source does not exist");
  });

  it("reports empty managed instructions during preview", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "   \n");

    const preview = await service.previewProfile("daily-coding");

    expect(preview.errors).toContain("Managed instructions are empty");
  });

  it("refuses non-AgentEnv skill target conflicts without writing", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await mkdir(join(paths.userSkillsDir, "agentenv-daily-coding-example-skill"), {
      recursive: true
    });

    const preview = await service.previewProfile("daily-coding");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain("Skill target already exists");
    }
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );
  });

  it("rolls back files from a backup", async () => {
    const { paths, service } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");

    const preview = await service.previewProfile("daily-coding");
    const applyResult = await service.applyProfile("daily-coding", preview.id);
    expect(applyResult.ok).toBe(true);

    const backups = await createBackupStore(paths).listBackups();
    const rollbackPreview = await service.previewRollback(backups[0]?.id ?? "");
    expect(rollbackPreview.changes[0]?.after).toBe("# Old agents\n");

    const rollbackResult = await service.rollback(backups[0]?.id ?? "");

    expect(rollbackResult.ok).toBe(true);
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );
  });

  it("refuses real Codex home writes by default", async () => {
    const { paths } = await makeEnv();
    const guardedPaths = createPaths({
      appDataRoot: paths.appDataRoot,
      codexHome: join(homedir(), ".codex"),
      userSkillsDir: paths.userSkillsDir,
      globalAgentsPath: paths.globalAgentsPath,
      codexConfigPath: paths.codexConfigPath
    });
    const guardedProfileStore = createProfileStore({
      appDataRoot: guardedPaths.appDataRoot,
      codexHome: guardedPaths.codexHome,
      userSkillsDir: guardedPaths.userSkillsDir
    });
    const guardedService = createActivationService({
      paths: guardedPaths,
      profileStore: guardedProfileStore
    });
    await writeFile(guardedPaths.globalAgentsPath, "# Old agents\n");

    const preview = await guardedService.previewProfile("daily-coding");
    const result = await guardedService.applyProfile("daily-coding", preview.id);

    expect(result).toEqual({
      ok: false,
      errors: ["Real Codex writes are disabled"]
    });
  });

  it("restores already-written files when target asset apply fails", async () => {
    const { paths } = await makeEnv();
    await writeFile(paths.globalAgentsPath, "# Old agents\n");
    await writeFile(paths.codexConfigPath, 'model = "gpt-5"\n');
    const baseProfileStore = createProfileStore({
      appDataRoot: paths.appDataRoot,
      codexHome: paths.codexHome,
      userSkillsDir: paths.userSkillsDir
    });
    const failingAdapter: AgentTargetAdapter = {
      descriptor: {
        id: "codex",
        name: "Failing Codex",
        description: "Test adapter",
        instructionsLabel: "AGENTS.md",
        configLabel: "config.toml",
        configLanguage: "toml",
        realWritesEnabled: false
      },
      createTargetPaths: () => ({
        targetId: "codex",
        configDir: paths.codexHome,
        instructionsPath: paths.globalAgentsPath,
        configPath: paths.codexConfigPath,
        skillsDir: paths.userSkillsDir
      }),
      createDefaultProfile: () => {
        throw new Error("not used");
      },
      readProfileFiles: () => {
        throw new Error("not used");
      },
      writeProfileFiles: () => {
        throw new Error("not used");
      },
      createPreview: async () => ({
        warnings: [],
        errors: [],
        changes: [
          {
            path: paths.globalAgentsPath,
            before: "# Old agents\n",
            after: "# New agents\n",
            diff: ""
          }
        ],
        liveFingerprints: {},
        targetState: { managedConfigKeys: [], managedMcpNames: [] }
      }),
      validateAssets: async () => [],
      getAssetBackupPaths: async () => [],
      applyAssets: async () => {
        throw new Error("asset copy exploded");
      }
    };
    const service = createActivationService({
      paths,
      profileStore: baseProfileStore,
      targetRegistry: createTargetRegistry([failingAdapter])
    });

    const preview = await service.previewProfile("daily-coding");
    const result = await service.applyProfile("daily-coding", preview.id);

    expect(result).toEqual({
      ok: false,
      errors: ["Failed to apply profile; restored backup: asset copy exploded"]
    });
    await expect(readFile(paths.globalAgentsPath, "utf8")).resolves.toBe(
      "# Old agents\n"
    );
  });
});
