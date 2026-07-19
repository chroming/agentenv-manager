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

describe("Antigravity Profile v2 switching e2e", () => {
  it("switches Instructions and Skills while leaving MCP config untouched", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-antigravity-v2-e2e-"));
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
        manifest: {
          id: `antigravity-${id}`,
          name: `Antigravity ${id}`,
          description: "",
          preferredTargetId: "antigravity",
          version: 2
        },
        instructions: `# ${id.toUpperCase()}\n`,
        resources: {
          skills: [{ libraryId: id, targetName: id, enabled: true }],
          mcpByTarget: { antigravity: { mode: "ignore", selections: [] } }
        }
      });
    }
    const geminiDir = join(paths.homeDir, ".gemini");
    const configDir = join(geminiDir, "config");
    const mcpConfig = '{\n  "mcpServers": { "private": { "command": "private" } }\n}\n';
    await mkdir(configDir, { recursive: true });
    await writeFile(join(geminiDir, "GEMINI.md"), "# Before\n");
    await writeFile(join(configDir, "mcp_config.json"), mcpConfig);
    const service = createActivationService({ paths, profileStore, settingsStore, skillLibraryStore });

    for (const id of ["alpha", "beta"] as const) {
      const profileId = `antigravity-${id}`;
      const preview = await service.previewProfile(profileId, "antigravity");
      expect(preview.errors).toEqual([]);
      expect(preview.changes.map(({ path }) => path)).not.toContain(join(configDir, "mcp_config.json"));
      expect((await service.applyProfile(profileId, preview.id)).ok).toBe(true);
    }

    expect(await readFile(join(geminiDir, "GEMINI.md"), "utf8")).toBe("# BETA\n");
    expect(await readFile(join(configDir, "mcp_config.json"), "utf8")).toBe(mcpConfig);
    await expect(readFile(join(geminiDir, "antigravity-cli", "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(geminiDir, "antigravity-cli", "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");
  });
});
