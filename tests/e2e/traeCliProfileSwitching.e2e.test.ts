import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createActivationService } from "../../src/main/activationService";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createSettingsStore } from "../../src/main/settingsStore";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";

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
    const yamlConfig = [
      "model: fast",
      "mcp_servers:",
      "  - name: docs",
      "    command: docs",
      "    disabled: true",
      "    env:",
      "      TOKEN: keep-yaml-secret",
      ""
    ].join("\n");
    const jsonConfig = `{
  "telemetry": false,
  "mcpServers": {
    "browser": {
      "url": "https://example.test/mcp",
      "headers": { "Authorization": "keep-json-secret" },
      "disabled": true
    }
  }
}\n`;
    await mkdir(traeDir, { recursive: true });
    await writeFile(join(traeDir, "AGENTS.md"), "# Before\n");
    await writeFile(join(traeDir, "trae_cli.yaml"), yamlConfig);
    await writeFile(join(traeDir, "mcp.json"), jsonConfig);
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
      expect(preview.errors).toEqual([]);
      const applied = await service.applyProfile(profileId, preview.id);
      expect(applied.ok).toBe(true);
      if (id === "beta" && applied.ok) betaBackupId = applied.backupId;
    }

    expect(await readFile(join(traeDir, "AGENTS.md"), "utf8")).toBe("# BETA\n");
    const finalYaml = await readFile(join(traeDir, "trae_cli.yaml"), "utf8");
    expect(finalYaml).toContain("model: fast");
    expect(finalYaml).toContain("TOKEN: keep-yaml-secret");
    expect(finalYaml).toContain("disabled: true");
    const finalJson = await readFile(join(traeDir, "mcp.json"), "utf8");
    expect(finalJson).toContain('"telemetry": false');
    expect(finalJson).toContain('"Authorization": "keep-json-secret"');
    expect(finalJson).toContain('"disabled": false');
    await expect(readFile(join(traeDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(traeDir, "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");

    const noOp = await service.previewProfile("trae-beta", "trae-cli");
    expect(noOp.errors).toEqual([]);
    expect(noOp.changes).toEqual([]);

    const rollbackPreview = await service.previewRollback(betaBackupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect((await service.rollback(betaBackupId)).ok).toBe(true);
    await expect(readFile(join(traeDir, "AGENTS.md"), "utf8"))
      .resolves.toBe("# ALPHA\n");
    await expect(readFile(join(traeDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .resolves.toContain("# alpha");
    await expect(readFile(join(traeDir, "skills", "beta", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(traeDir, "trae_cli.yaml"), "utf8"))
      .resolves.toContain("disabled: false");
    await expect(readFile(join(traeDir, "mcp.json"), "utf8"))
      .resolves.toContain('"disabled": true');
  });
});
