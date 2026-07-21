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

describe("Claude Code Profile v2 switching e2e", () => {
  it("switches Instructions and Skills while preserving settings and MCP definitions byte-for-byte", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-claude-v2-e2e-"));
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
          id: `claude-${id}`,
          name: `Claude ${id}`,
          description: "",
          preferredTargetId: "claude-code",
          version: 2
        },
        instructions: `# ${id.toUpperCase()}\n`,
        resources: {
          skills: [{ libraryId: id, targetName: id, enabled: true }],
          mcpByTarget: { "claude-code": { mode: "ignore", selections: [] } }
        }
      });
    }
    const claudeDir = join(paths.homeDir, ".claude");
    const settingsText = '{\n  "permissions": { "defaultMode": "bypassPermissions" },\n  "env": { "TOKEN": "user-owned" }\n}\n';
    const mcpText = '{\n  "mcpServers": { "docs": { "command": "docs" } },\n  "projects": {}\n}\n';
    await mkdir(claudeDir, { recursive: true });
    await writeFile(join(claudeDir, "CLAUDE.md"), "# Before\n");
    await writeFile(join(claudeDir, "settings.json"), settingsText);
    await writeFile(join(paths.homeDir, ".claude.json"), mcpText);
    const service = createActivationService({ paths, profileStore, settingsStore, skillLibraryStore });

    for (const id of ["alpha", "beta"] as const) {
      const profileId = `claude-${id}`;
      const preview = await service.previewProfile(profileId, "claude-code");
      expect(blockingMessages(preview.issues)).toEqual([]);
      expect(preview.changes.map(({ path }) => path)).not.toContain(join(claudeDir, "settings.json"));
      expect(preview.changes.map(({ path }) => path)).not.toContain(join(paths.homeDir, ".claude.json"));
      expect((await service.applyProfile(profileId, preview.id)).ok).toBe(true);
    }

    expect(await readFile(join(claudeDir, "CLAUDE.md"), "utf8")).toBe("# BETA\n");
    expect(await readFile(join(claudeDir, "settings.json"), "utf8")).toBe(settingsText);
    expect(await readFile(join(paths.homeDir, ".claude.json"), "utf8")).toBe(mcpText);
    await expect(readFile(join(claudeDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(claudeDir, "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");
  });
});
