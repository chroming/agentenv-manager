import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { blockingMessages } from "../helpers/applyIssues";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Trae CLI Profile v2 switching e2e", () => {
  it("switches Instructions, Skills, and selected MCP states without owning definitions", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-trae-cli-v2-e2e-"));
    const paths = createPaths({
      appDataRoot: join(root, "data"),
      homeDir: join(root, "home")
    });
    const profileStore = createProfileStore({
      appDataRoot: paths.appDataRoot,
      homeDir: paths.homeDir
    });
    const settingsStore = createSettingsStore(paths);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);

    for (const id of ["alpha", "beta"]) {
      const source = join(root, "sources", id);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), `---\nname: ${id}\n---\n# ${id}\n`);
      await skillLibraryStore.importSkill({ sourcePath: source, id });
      await profileStore.saveProfile({
        manifest: {
          id: `trae-${id}`,
          name: `Trae ${id}`,
          description: "",
          preferredTargetId: "trae-cli",
          version: 2
        },
        instructions: `# ${id.toUpperCase()}\n`,
        resources: {
          skills: [{ libraryId: id, targetName: id, enabled: true }],
          mcpByTarget: {
            "trae-cli": {
              mode: "manage",
              selections: [
                { name: "docs", enabled: id === "alpha" },
                { name: "browser", enabled: id === "beta" }
              ]
            }
          }
        }
      });
    }

    const traeDir = join(paths.homeDir, ".trae");
    const tomlConfig = [
      'model = "fast"',
      "",
      "[mcp_servers.docs]",
      'command = "docs"',
      "enabled = false",
      "",
      "[mcp_servers.docs.env]",
      'TOKEN = "keep-toml-secret"',
      "",
      "[mcp_servers.browser]",
      'url = "https://example.test/mcp"',
      "enabled = false",
      "",
      "[mcp_servers.browser.headers]",
      'Authorization = "keep-header-secret"',
      ""
    ].join("\n");
    await mkdir(join(traeDir, "rules"), { recursive: true });
    await mkdir(join(traeDir, "cli"), { recursive: true });
    await writeFile(join(traeDir, "AGENTS.md"), "# Before\n");
    await writeFile(join(traeDir, "traecli.toml"), tomlConfig);
    await writeFile(join(traeDir, "cli", "auth.json"), '{"token":"runtime-owned"}\n');
    const service = createActivationService({
      paths,
      profileStore,
      settingsStore,
      skillLibraryStore
    });

    let betaBackupId = "";
    for (const id of ["alpha", "beta"] as const) {
      const profileId = `trae-${id}`;
      const preview = await service.previewProfile(profileId, "trae-cli");
      expect(blockingMessages(preview.issues)).toEqual([]);
      const applied = await service.applyProfile(profileId, preview.id);
      expect(applied.ok).toBe(true);
      if (id === "beta" && applied.ok) betaBackupId = applied.backupId;
    }

    expect(await readFile(join(traeDir, "rules", "agentenv-manager.md"), "utf8"))
      .toBe("# BETA\n");
    expect(await readFile(join(traeDir, "AGENTS.md"), "utf8")).toBe("# Before\n");
    const finalToml = await readFile(join(traeDir, "traecli.toml"), "utf8");
    expect(finalToml).toContain('model = "fast"');
    expect(finalToml).toContain('TOKEN = "keep-toml-secret"');
    expect(finalToml).toContain('Authorization = "keep-header-secret"');
    expect(finalToml).toContain("[mcp_servers.docs]\ncommand = \"docs\"\nenabled = false");
    expect(finalToml).toContain("[mcp_servers.browser]\nurl = \"https://example.test/mcp\"\nenabled = true");
    await expect(readFile(join(traeDir, "cli", "auth.json"), "utf8"))
      .resolves.toBe('{"token":"runtime-owned"}\n');
    await expect(readFile(join(traeDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(traeDir, "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");

    const noOp = await service.previewProfile("trae-beta", "trae-cli");
    expect(blockingMessages(noOp.issues)).toEqual([]);
    expect(noOp.changes).toEqual([]);

    const rollbackPreview = await service.previewRollback(betaBackupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect((await service.rollback(betaBackupId)).ok).toBe(true);
    await expect(readFile(join(traeDir, "rules", "agentenv-manager.md"), "utf8"))
      .resolves.toBe("# ALPHA\n");
    await expect(readFile(join(traeDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .resolves.toContain("# alpha");
    await expect(readFile(join(traeDir, "skills", "beta", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    const rolledBackToml = await readFile(join(traeDir, "traecli.toml"), "utf8");
    expect(rolledBackToml).toContain(
      "[mcp_servers.docs]\ncommand = \"docs\"\nenabled = true"
    );
    expect(rolledBackToml).toContain(
      "[mcp_servers.browser]\nurl = \"https://example.test/mcp\"\nenabled = false"
    );
    await expect(readFile(join(traeDir, "cli", "auth.json"), "utf8"))
      .resolves.toBe('{"token":"runtime-owned"}\n');
  });
});
