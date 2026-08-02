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
      expect(blockingMessages(preview.issues)).toEqual([]);
      expect(preview.changes.map(({ path }) => path)).not.toContain(join(configDir, "mcp_config.json"));
      expect((await service.applyProfile(profileId, preview.id)).ok).toBe(true);
    }

    expect(await readFile(join(geminiDir, "GEMINI.md"), "utf8")).toBe("# BETA\n");
    expect(await readFile(join(configDir, "mcp_config.json"), "utf8")).toBe(mcpConfig);
    await expect(readFile(join(geminiDir, "antigravity-cli", "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(geminiDir, "antigravity-cli", "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");

    const saved = await profileStore.readProfile("antigravity-beta");
    await profileStore.saveProfile({
      manifest: saved.manifest,
      instructions: saved.instructions,
      resources: {
        ...saved.resources,
        managementByTarget: {
          antigravity: { instructions: "disable", skills: "disable" }
        }
      },
      expectedContentHash: saved.contentHash
    });

    const disabledPreview = await service.previewProfile("antigravity-beta", "antigravity");
    expect(blockingMessages(disabledPreview.issues)).toEqual([]);
    expect(disabledPreview.changes).toContainEqual(expect.objectContaining({
      path: join(geminiDir, "GEMINI.md"),
      action: "remove"
    }));
    expect(disabledPreview.resourceChanges).toContainEqual(expect.objectContaining({
      kind: "skill",
      action: "remove",
      name: "beta"
    }));
    expect((await service.applyProfile("antigravity-beta", disabledPreview.id)).ok).toBe(true);
    await expect(readFile(join(geminiDir, "GEMINI.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(geminiDir, "antigravity-cli", "skills", "beta", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    expect(await readFile(join(configDir, "mcp_config.json"), "utf8")).toBe(mcpConfig);

    const disabled = await profileStore.readProfile("antigravity-beta");
    await profileStore.saveProfile({
      manifest: disabled.manifest,
      instructions: disabled.instructions,
      resources: {
        ...disabled.resources,
        managementByTarget: {
          antigravity: { instructions: "manage", skills: "manage" }
        }
      },
      expectedContentHash: disabled.contentHash
    });
    const restoredPreview = await service.previewProfile("antigravity-beta", "antigravity");
    expect(blockingMessages(restoredPreview.issues)).toEqual([]);
    expect((await service.applyProfile("antigravity-beta", restoredPreview.id)).ok).toBe(true);
    expect(await readFile(join(geminiDir, "GEMINI.md"), "utf8")).toBe("# BETA\n");
    await expect(readFile(join(geminiDir, "antigravity-cli", "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");
  });
});
