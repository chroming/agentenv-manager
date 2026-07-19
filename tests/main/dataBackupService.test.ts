import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDataBackup,
  inspectDataBackup,
  restoreDataBackup
} from "../../src/main/dataBackupService";
import { ensureAppDataFormat } from "../../src/main/appDataFormat";
import { createPaths } from "../../src/main/paths";
import { createProfileStore } from "../../src/main/profileStore";
import { createTargetRegistry } from "../../src/main/targets/registry";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("AgentEnv data backup service", () => {
  it("backs up and restores the complete application data directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const paths = createPaths({ appDataRoot: join(root, "active-data") });
    const backupRoot = join(root, "exports");
    await mkdir(backupRoot, { recursive: true });
    await ensureAppDataFormat(paths);
    const registry = createTargetRegistry();
    await createProfileStore({ appDataRoot: paths.appDataRoot }, registry).saveProfile(
      registry.get("opencode").createDefaultProfile("daily-coding")
    );
    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "# Original\n");
    const legacyMcpLibraryPath = join(paths.appDataRoot, "mcp-library.json");
    await writeFile(legacyMcpLibraryPath, "[]\n");

    const backup = await createDataBackup(paths, backupRoot);
    const preview = await inspectDataBackup(backup.path);
    expect(preview.formatVersion).toBe(1);
    expect(preview.topLevelItemCount).toBe(3);

    await writeFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "# Changed\n");
    await writeFile(join(paths.appDataRoot, "temporary.json"), "{}\n");
    const result = await restoreDataBackup(paths, backup.path);

    await expect(
      readFile(join(paths.profilesDir, "daily-coding", "AGENTS.md"), "utf8")
    ).resolves.toBe("# Original\n");
    await expect(readFile(legacyMcpLibraryPath, "utf8")).resolves.toBe("[]\n");
    await expect(readFile(join(paths.appDataRoot, "temporary.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(inspectDataBackup(result.safetyBackupPath)).resolves.toMatchObject({
      formatVersion: 1
    });
  });

  it("rejects exports inside the active AgentEnv data directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const paths = createPaths({ appDataRoot: join(root, "active-data") });
    await mkdir(paths.appDataRoot, { recursive: true });

    await expect(createDataBackup(paths, paths.appDataRoot)).rejects.toThrow(
      "outside the active data directory"
    );
  });

  it("rejects folders without a supported AgentEnv backup manifest", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const invalid = join(root, "invalid");
    await mkdir(invalid, { recursive: true });
    await writeFile(join(invalid, "agentenv-backup.json"), '{"formatVersion":99}\n');

    await expect(inspectDataBackup(invalid)).rejects.toThrow(
      "Unsupported or invalid AgentEnv backup"
    );
  });

  it("rejects restore packages containing symbolic links", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const backup = join(root, "backup");
    await mkdir(join(backup, "data"), { recursive: true });
    await writeFile(
      join(backup, "agentenv-backup.json"),
      '{"formatVersion":1,"createdAt":"2026-07-12T00:00:00.000Z"}\n'
    );
    await symlink(root, join(backup, "data", "escape"));

    await expect(inspectDataBackup(backup)).rejects.toThrow("cannot contain symbolic links");
  });

  it("rejects a structurally invalid backup before touching active data", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const paths = createPaths({ appDataRoot: join(root, "active-data") });
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(join(paths.appDataRoot, "keep.txt"), "active\n");
    const backup = join(root, "backup");
    await mkdir(join(backup, "data", "profiles", "broken"), { recursive: true });
    await writeFile(
      join(backup, "agentenv-backup.json"),
      '{"formatVersion":1,"createdAt":"2026-07-12T00:00:00.000Z"}\n'
    );
    await writeFile(
      join(backup, "data", "profiles", "broken", "profile.json"),
      "{}\n"
    );

    await expect(restoreDataBackup(paths, backup)).rejects.toThrow();
    await expect(readFile(join(paths.appDataRoot, "keep.txt"), "utf8")).resolves.toBe(
      "active\n"
    );
  });

  it("restores the previous data when post-copy validation fails", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-data-backup-"));
    const paths = createPaths({ appDataRoot: join(root, "active-data") });
    const backupRoot = join(root, "exports");
    await mkdir(paths.appDataRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });
    await ensureAppDataFormat(paths);
    await writeFile(join(paths.appDataRoot, "value.txt"), "backup\n");
    const backup = await createDataBackup(paths, backupRoot);
    await writeFile(join(paths.appDataRoot, "value.txt"), "current\n");
    let validationCount = 0;

    await expect(
      restoreDataBackup(paths, backup.path, {
        validate: async () => {
          validationCount += 1;
          if (validationCount === 2) throw new Error("post-copy validation failed");
        }
      })
    ).rejects.toThrow("previous AgentEnv data was restored");

    expect(validationCount).toBe(3);
    await expect(readFile(join(paths.appDataRoot, "value.txt"), "utf8")).resolves.toBe(
      "current\n"
    );
  });
});
