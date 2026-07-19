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

describe("Codex Profile v2 switching e2e", () => {
  it("switches portable resources and preserves unrelated config.toml keys", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-codex-v2-e2e-"));
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const profileStore = createProfileStore({ appDataRoot: paths.appDataRoot, homeDir: paths.homeDir });
    const settingsStore = createSettingsStore(paths);
    const skillLibraryStore = createSkillLibraryStore(paths, settingsStore);
    for (const id of ["alpha", "beta"]) {
      const source = join(root, "sources", id);
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), `---\nname: ${id}\n---\n# ${id}\n`);
      await skillLibraryStore.importSkill({ sourcePath: source, id });
      await profileStore.saveProfile({
        manifest: { id, name: id, description: "", preferredTargetId: "codex", version: 2 },
        instructions: `# ${id.toUpperCase()}\n`,
        resources: {
          skills: [{ libraryId: id, targetName: id, enabled: true }],
          mcpByTarget: {
            codex: {
              mode: "manage",
              selections: [
                { name: "alpha", enabled: id === "alpha" },
                { name: "beta", enabled: id === "beta" }
              ]
            }
          }
        }
      });
    }
    await mkdir(paths.codexHome, { recursive: true });
    await writeFile(paths.globalAgentsPath, "# Before\n");
    await writeFile(paths.codexConfigPath, [
      'model = "gpt-5"',
      'approval_policy = "on-request"',
      "",
      "[mcp_servers.alpha]", 'command = "alpha"', "enabled = false",
      "",
      "[mcp_servers.beta]", 'command = "beta"', "enabled = true", ""
    ].join("\n"));
    const service = createActivationService({ paths, profileStore, settingsStore, skillLibraryStore });

    for (const id of ["alpha", "beta"] as const) {
      const preview = await service.previewProfile(id, "codex");
      expect(preview.errors).toEqual([]);
      expect((await service.applyProfile(id, preview.id)).ok).toBe(true);
    }

    expect(await readFile(paths.globalAgentsPath, "utf8")).toBe("# BETA\n");
    const config = await readFile(paths.codexConfigPath, "utf8");
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain('approval_policy = "on-request"');
    expect(config.match(/enabled = false/g)).toHaveLength(1);
    expect(config.match(/enabled = true/g)).toHaveLength(1);
    await expect(readFile(join(paths.codexHome, "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(paths.codexHome, "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");
  });
});
