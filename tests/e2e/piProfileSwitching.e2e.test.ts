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

describe("Pi Profile v2 switching e2e", () => {
  it("switches Instructions and dedicated Skills while preserving all Pi settings", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-pi-v2-e2e-"));
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
      await writeFile(
        join(source, "SKILL.md"),
        `---\nname: ${id}\ndescription: ${id} workflow\n---\n# ${id}\n`
      );
      await skillLibraryStore.importSkill({ sourcePath: source, id });
      await profileStore.saveProfile({
        manifest: {
          id: `pi-${id}`,
          name: `Pi ${id}`,
          description: "",
          preferredTargetId: "pi",
          version: 2
        },
        instructions: `# ${id.toUpperCase()}\n`,
        resources: {
          skills: [{ libraryId: id, targetName: id, enabled: true }],
          mcpByTarget: { pi: { mode: "ignore", selections: [] } }
        }
      });
    }

    const piDir = join(paths.homeDir, ".pi", "agent");
    const settingsText = `${JSON.stringify({
      theme: "dark",
      sessionDir: "history",
      packages: ["git:github.com/example/pi-tools"],
      provider: { token: "pi-owned-secret" }
    }, null, 2)}\n`;
    await mkdir(piDir, { recursive: true });
    await writeFile(join(piDir, "AGENTS.md"), "# Before\n");
    await writeFile(join(piDir, "settings.json"), settingsText);
    const service = createActivationService({
      paths,
      profileStore,
      settingsStore,
      skillLibraryStore
    });

    let betaBackupId = "";
    for (const id of ["alpha", "beta"] as const) {
      const profileId = `pi-${id}`;
      const preview = await service.previewProfile(profileId, "pi");
      expect(blockingMessages(preview.issues)).toEqual([]);
      expect(preview.changes.map(({ path }) => path)).not.toContain(
        join(piDir, "settings.json")
      );
      const applied = await service.applyProfile(profileId, preview.id);
      expect(applied.ok).toBe(true);
      if (id === "beta" && applied.ok) betaBackupId = applied.backupId;
    }

    expect(await readFile(join(piDir, "AGENTS.md"), "utf8")).toBe("# BETA\n");
    expect(await readFile(join(piDir, "settings.json"), "utf8")).toBe(
      settingsText
    );
    await expect(readFile(join(piDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(piDir, "skills", "beta", "SKILL.md"), "utf8"))
      .resolves.toContain("# beta");

    const noOp = await service.previewProfile("pi-beta", "pi");
    expect(blockingMessages(noOp.issues)).toEqual([]);
    expect(noOp.changes).toEqual([]);

    const rollbackPreview = await service.previewRollback(betaBackupId);
    expect(rollbackPreview.errors).toEqual([]);
    expect((await service.rollback(betaBackupId)).ok).toBe(true);
    await expect(readFile(join(piDir, "AGENTS.md"), "utf8"))
      .resolves.toBe("# ALPHA\n");
    await expect(readFile(join(piDir, "skills", "alpha", "SKILL.md"), "utf8"))
      .resolves.toContain("# alpha");
    await expect(readFile(join(piDir, "skills", "beta", "SKILL.md"), "utf8"))
      .rejects.toThrow();
    await expect(readFile(join(piDir, "settings.json"), "utf8"))
      .resolves.toBe(settingsText);
  });
});
