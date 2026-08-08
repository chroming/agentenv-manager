import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackupStore } from "../../src/main/backupStore";
import {
  createBackupMutationClaimer,
  restoreBackupEntries,
  restoreBackupWithSafety
} from "../../src/main/backupRestore";
import { hashPathEntry } from "../../src/main/filesystemIntegrity";
import { createPaths } from "../../src/main/paths";

let root = "";

const rewriteBackupManifest = async (manifestPath: string, value: unknown) => {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(manifestPath, content, "utf8");
  await writeFile(
    join(manifestPath, "..", "manifest.sha256"),
    `${createHash("sha256").update(content).digest("hex")}\n`,
    "utf8"
  );
};

const makePaths = async () => {
  root = await mkdtemp(join(tmpdir(), "agentenv-backup-"));
  const codexHome = join(root, ".codex");
  const userSkillsDir = join(root, ".agents", "skills");
  await mkdir(codexHome, { recursive: true });
  await mkdir(userSkillsDir, { recursive: true });
  return createPaths({ appDataRoot: root, codexHome, userSkillsDir });
};

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("backup store", () => {
  it("creates a backup manifest with sha256 entries", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Agent\n");
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    const manifest = await store.createBackup([paths.globalAgentsPath]);

    expect(manifest.id).toBe("2026-06-30T00-00-00-000Z");
    expect(manifest.entries[0]).toMatchObject({
      sourcePath: paths.globalAgentsPath,
      missing: false
    });
    expect(manifest.entries[0]?.sha256).toHaveLength(64);
    await expect(readFile(manifest.entries[0]?.backupPath ?? "", "utf8")).resolves.toBe(
      "# Agent\n"
    );
  });

  it("keeps legacy backups readable without weakening new backup receipts", async () => {
    const paths = await makePaths();
    const id = "2026-06-01T00-00-00-000Z";
    const sourcePath = paths.globalAgentsPath;
    const backupDir = join(paths.backupsDir, id);
    const backupPath = join(
      backupDir,
      "files",
      Buffer.from(sourcePath).toString("base64url")
    );
    await mkdir(join(backupDir, "files"), { recursive: true });
    await writeFile(backupPath, "# Legacy backup\n");
    await writeFile(
      join(backupDir, "manifest.json"),
      `${JSON.stringify({
        id,
        createdAt: "2026-06-01T00:00:00.000Z",
        entries: [{
          sourcePath,
          backupPath,
          sha256: createHash("sha256").update("# Legacy backup\n").digest("hex"),
          missing: false,
          kind: "file"
        }]
      }, null, 2)}\n`
    );
    const store = createBackupStore(paths);

    const legacy = await store.readBackup(id);
    expect(legacy).toMatchObject({ formatVersion: 2, id });
    expect(legacy.entries[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    await restoreBackupEntries(legacy);
    await expect(readFile(sourcePath, "utf8")).resolves.toBe("# Legacy backup\n");
  });

  it("records missing files instead of crashing", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    const manifest = await store.createBackup([paths.codexConfigPath]);

    expect(manifest.entries[0]).toMatchObject({
      sourcePath: paths.codexConfigPath,
      missing: true
    });
    expect(manifest.entries[0]?.backupPath).toBeUndefined();
  });

  it("fails when an existing source changes during copy instead of recording it as missing", async () => {
    const paths = await makePaths();
    const source = join(root, "changing-source");
    await mkdir(source);
    await writeFile(join(source, "content.txt"), "important\n");
    const copyError = Object.assign(new Error("nested entry disappeared"), {
      code: "ENOENT"
    });
    const store = createBackupStore(paths, {
      copyPath: vi.fn().mockRejectedValue(copyError)
    });

    await expect(store.createBackup([source])).rejects.toThrow(
      "nested entry disappeared"
    );
    await expect(store.listBackups()).resolves.toEqual([]);
    await expect(readFile(join(source, "content.txt"), "utf8"))
      .resolves.toBe("important\n");
  });

  it("stores symbolic-link metadata without creating a privileged backup link", async () => {
    const paths = await makePaths();
    const destination = join(root, "shared-skills");
    const source = join(root, "skills-link");
    await mkdir(destination, { recursive: true });
    await symlink(destination, source, "dir");
    const store = createBackupStore(paths);

    const manifest = await store.createBackup([source]);
    const entry = manifest.entries[0];

    expect(entry).toMatchObject({
      sourcePath: source,
      linkTarget: destination,
      linkType: "dir",
      kind: "symlink",
      missing: false
    });
    expect(entry?.backupPath).toBeUndefined();
    await expect(store.readBackup(manifest.id)).resolves.toMatchObject({
      entries: [{ linkTarget: destination, linkType: "dir" }]
    });
  });

  it("claims missing ancestor containers created as part of a child mutation", async () => {
    const paths = await makePaths();
    const missingRoot = join(root, "target", "skills");
    const missingSkill = join(missingRoot, "review");
    const backup = await createBackupStore(paths).createBackup([
      missingRoot,
      missingSkill
    ]);
    const claim = createBackupMutationClaimer(backup);

    await claim(missingSkill);

    expect(claim.claimedPaths).toEqual(
      new Set([resolve(missingRoot), resolve(missingSkill)])
    );
  });

  it("records missing ancestor containers when a claimed child creates them", async () => {
    const paths = await makePaths();
    const missingRoot = join(root, "target", "skills");
    const missingSkill = join(missingRoot, "review");
    const backup = await createBackupStore(paths).createBackup([
      missingRoot,
      missingSkill
    ]);
    const claim = createBackupMutationClaimer(backup);

    await claim(missingSkill);
    await mkdir(missingSkill, { recursive: true });
    await writeFile(join(missingSkill, "SKILL.md"), "# Review\n");
    await claim.recordMutation(missingSkill);

    expect(claim.mutatedPaths).toEqual(
      new Set([resolve(missingRoot), resolve(missingSkill)])
    );
    await expect(claim.findUnrecordedChanges()).resolves.toEqual([]);
  });

  it("rejects a repeated child claim when its created ancestor changed externally", async () => {
    const paths = await makePaths();
    const missingRoot = join(root, "target", "skills");
    const missingSkill = join(missingRoot, "review");
    const backup = await createBackupStore(paths).createBackup([
      missingRoot,
      missingSkill
    ]);
    const claim = createBackupMutationClaimer(backup);

    await claim(missingSkill);
    await mkdir(missingSkill, { recursive: true });
    await claim.recordMutation(missingSkill);
    await writeFile(join(missingRoot, "external.txt"), "external\n");

    await expect(claim(missingSkill)).rejects.toThrow(
      "changed after its previous mutation receipt"
    );
  });

  it("restores relative links inside a backed-up directory without rewriting them", async () => {
    const paths = await makePaths();
    const source = join(root, "skill-with-link");
    await mkdir(source);
    await writeFile(join(source, "source.md"), "source\n");
    await symlink("source.md", join(source, "alias.md"));
    const store = createBackupStore(paths);
    const manifest = await store.createBackup([source]);
    await rm(source, { recursive: true, force: true });
    await mkdir(source);
    await writeFile(join(source, "changed.md"), "changed\n");

    await restoreBackupEntries(manifest);

    expect((await lstat(join(source, "alias.md"))).isSymbolicLink()).toBe(true);
    await expect(readlink(join(source, "alias.md"))).resolves.toBe("source.md");
    await expect(readFile(join(source, "source.md"), "utf8")).resolves.toBe("source\n");
  });

  it("does not restore over a path changed after recovery preflight", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Original\n");
    const manifest = await createBackupStore(paths).createBackup([paths.globalAgentsPath]);
    await writeFile(paths.globalAgentsPath, "# Reviewed current\n");
    const reviewedHash = await hashPathEntry(paths.globalAgentsPath);
    await writeFile(paths.globalAgentsPath, "# Newer external edit\n");

    await expect(restoreBackupEntries(manifest, {
      expectedCurrentHashes: new Map([[resolve(paths.globalAgentsPath), reviewedHash]])
    })).rejects.toThrow("changed before mutation");

    await expect(readFile(paths.globalAgentsPath, "utf8"))
      .resolves.toBe("# Newer external edit\n");
  });

  it("records file permissions needed for an exact rollback", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Agent\n");
    await chmod(paths.globalAgentsPath, 0o644);
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    const manifest = await store.createBackup([paths.globalAgentsPath]);

    expect(manifest.entries[0]?.mode).toBe(0o644);
    await expect(store.readBackup(manifest.id)).resolves.toMatchObject({
      entries: [{ mode: 0o644 }]
    });
  });

  it("recovers permissions from legacy backup content without a recorded mode", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Agent\n");
    await chmod(paths.globalAgentsPath, 0o640);
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([paths.globalAgentsPath]);
    const manifestPath = join(paths.backupsDir, manifest.id, "manifest.json");
    const legacyManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete legacyManifest.entries[0].mode;
    await rewriteBackupManifest(manifestPath, legacyManifest);

    const restored = await store.readBackup(manifest.id);

    expect(restored.entries[0]?.mode).toBe(0o640);
  });

  it("creates the backup root with owner-only permissions where supported", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    await store.createBackup([]);
    const mode = (await stat(paths.backupsDir)).mode & 0o777;

    expect(mode).toBe(0o700);
  });

  it("keeps backups unique when multiple operations share the same timestamp", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });

    const first = await store.createBackup([]);
    const second = await store.createBackup([]);

    expect(first.id).toBe("2026-06-30T00-00-00-000Z");
    expect(second.id).toBe("2026-06-30T00-00-00-000Z-1");
    await expect(store.listBackups()).resolves.toHaveLength(2);
  });

  it("resolves backup files after the AgentEnv data directory moves to another machine", async () => {
    const basePaths = await makePaths();
    const oldPaths = createPaths({
      appDataRoot: join(root, "old-machine", "agentenv-manager"),
      homeDir: basePaths.homeDir,
      codexHome: basePaths.codexHome,
      userSkillsDir: basePaths.userSkillsDir
    });
    await writeFile(oldPaths.globalAgentsPath, "# Portable backup\n");
    const oldStore = createBackupStore(oldPaths, {
      now: () => new Date("2026-07-09T04:35:47.638Z")
    });
    const manifest = await oldStore.createBackup([oldPaths.globalAgentsPath]);
    const recordedBackupPath = manifest.entries[0]?.backupPath ?? "";

    const newPaths = createPaths({
      appDataRoot: join(root, "new-machine", "agentenv-manager"),
      homeDir: basePaths.homeDir,
      codexHome: basePaths.codexHome,
      userSkillsDir: basePaths.userSkillsDir
    });
    await mkdir(newPaths.appDataRoot, { recursive: true });
    await rename(oldPaths.backupsDir, newPaths.backupsDir);

    const restored = await createBackupStore(newPaths).readBackup(manifest.id);

    expect(restored.entries[0]?.backupPath).not.toBe(recordedBackupPath);
    expect(restored.entries[0]?.backupPath).toContain(newPaths.backupsDir);
    await expect(readFile(restored.entries[0]?.backupPath ?? "", "utf8")).resolves.toBe(
      "# Portable backup\n"
    );
  });

  it("ignores non-activation backup namespaces", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    await store.createBackup([]);
    await mkdir(join(paths.backupsDir, "skill-cleanup", "cleanup-1"), { recursive: true });

    await expect(store.listBackups()).resolves.toEqual([
      {
        id: "2026-06-30T00-00-00-000Z",
        createdAt: "2026-06-30T00:00:00.000Z",
        fileCount: 0
      }
    ]);
  });

  it("rejects a tampered manifest that expands rollback outside a safe id", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([], {
      profileId: "daily-coding",
      targetId: "opencode"
    });
    const manifestPath = join(paths.backupsDir, manifest.id, "manifest.json");
    const tampered = JSON.parse(await readFile(manifestPath, "utf8"));
    tampered.profileId = "../../outside";
    await rewriteBackupManifest(manifestPath, tampered);

    await expect(store.readBackup(manifest.id)).rejects.toThrow();
  });

  it("rejects a backup manifest changed without a matching integrity receipt", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths);
    const manifest = await store.createBackup([]);
    const manifestPath = join(paths.backupsDir, manifest.id, "manifest.json");
    const changed = JSON.parse(await readFile(manifestPath, "utf8"));
    changed.profileName = "Changed after commit";
    await writeFile(manifestPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");

    await expect(store.readBackup(manifest.id)).rejects.toThrow(
      "manifest failed its integrity check"
    );
  });

  it("rejects a manifest that maps an entry to an unrelated backup file", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Agent\n");
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([paths.globalAgentsPath]);
    const manifestPath = join(paths.backupsDir, manifest.id, "manifest.json");
    const tampered = JSON.parse(await readFile(manifestPath, "utf8"));
    tampered.entries[0].backupPath = join(root, "unrelated.txt");
    await rewriteBackupManifest(manifestPath, tampered);

    await expect(store.readBackup(manifest.id)).rejects.toThrow(
      "Invalid AgentEnv backup file mapping"
    );
  });

  it("keeps valid backups available when another backup is malformed", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const valid = await store.createBackup([]);
    const invalidId = "2026-07-09T04-35-47-638Z";
    await mkdir(join(paths.backupsDir, invalidId), { recursive: true });
    await writeFile(join(paths.backupsDir, invalidId, "manifest.json"), "not json\n");
    await writeFile(join(paths.backupsDir, ".DS_Store"), "system file\n");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(store.listBackups()).resolves.toEqual([
      {
        id: valid.id,
        createdAt: valid.createdAt,
        fileCount: 0
      }
    ]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(`Ignoring invalid backup ${invalidId}`)
    );
    await store.listBackups();
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  it("rejects a backup file replaced by a symbolic link", async () => {
    const paths = await makePaths();
    const source = paths.globalAgentsPath;
    const unrelated = join(root, "unrelated.txt");
    await writeFile(source, "# Agent\n", "utf8");
    await writeFile(unrelated, "do not restore me\n", "utf8");
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([source]);
    const backupPath = manifest.entries[0]?.backupPath ?? "";
    await rm(backupPath);
    await symlink(unrelated, backupPath);

    await expect(store.readBackup(manifest.id)).rejects.toThrow(
      "backup content does not match its manifest"
    );
  });

  it("rejects a managed backup directory replaced by a symbolic link", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([]);
    const backupDir = join(paths.backupsDir, manifest.id);
    const movedDir = join(root, "moved-backup");
    await rename(backupDir, movedDir);
    await symlink(movedDir, backupDir, "dir");

    await expect(store.readBackup(manifest.id)).rejects.toThrow(
      "Invalid AgentEnv backup directory"
    );
  });

  it("rejects backup payload content changed after it was committed", async () => {
    const paths = await makePaths();
    await writeFile(paths.globalAgentsPath, "# Agent\n", "utf8");
    const store = createBackupStore(paths);
    const manifest = await store.createBackup([paths.globalAgentsPath]);

    await writeFile(manifest.entries[0]?.backupPath ?? "", "# Tampered\n", "utf8");

    await expect(store.readBackup(manifest.id)).rejects.toThrow(
      "payload failed its integrity check"
    );
  });

  it("restores the safety snapshot when requested content is written before verification fails", async () => {
    const paths = await makePaths();
    const target = paths.globalAgentsPath;
    await writeFile(target, "# Requested state\n", "utf8");
    const store = createBackupStore(paths);
    const requested = await store.createBackup([target]);
    await writeFile(target, "# Current state\n", "utf8");
    const invalidRequested = {
      ...requested,
      entries: requested.entries.map((entry) => ({
        ...entry,
        sha256: "0".repeat(64)
      }))
    };

    await expect(restoreBackupWithSafety({
      backup: invalidRequested,
      backupStore: store
    })).rejects.toThrow("restored from safety backup");

    await expect(readFile(target, "utf8")).resolves.toBe("# Current state\n");
  });

  it("preserves data changed after an operation write instead of rolling it back", async () => {
    const paths = await makePaths();
    const target = paths.globalAgentsPath;
    await writeFile(target, "# Original state\n", "utf8");
    const store = createBackupStore(paths);
    const requested = await store.createBackup([target]);
    await writeFile(target, "# AgentEnv operation state\n", "utf8");
    const operationHash = await hashPathEntry(target);
    await writeFile(target, "# New external state\n", "utf8");

    await expect(restoreBackupWithSafety({
      backup: requested,
      backupStore: store,
      expectedCurrentHashes: new Map([[resolve(target), operationHash]])
    })).rejects.toMatchObject({
      name: "BackupRecoveryError",
      requestedBackupId: requested.id
    });

    await expect(readFile(target, "utf8")).resolves.toBe("# New external state\n");
    await expect(store.listBackups()).resolves.toHaveLength(2);
  });

  it("restores owned paths while preserving an unselected external change", async () => {
    const paths = await makePaths();
    const ownedTarget = paths.globalAgentsPath;
    const externalTarget = join(root, "external.md");
    await writeFile(ownedTarget, "# Original owned\n", "utf8");
    await writeFile(externalTarget, "# Original external\n", "utf8");
    const store = createBackupStore(paths);
    const requested = await store.createBackup([ownedTarget, externalTarget]);
    await writeFile(ownedTarget, "# AgentEnv owned write\n", "utf8");
    await writeFile(externalTarget, "# AgentEnv external write\n", "utf8");
    const operationHashes = new Map<string, string | undefined>([
      [resolve(ownedTarget), await hashPathEntry(ownedTarget)],
      [resolve(externalTarget), await hashPathEntry(externalTarget)]
    ]);
    await writeFile(externalTarget, "# Newer external edit\n", "utf8");

    await restoreBackupWithSafety({
      backup: {
        ...requested,
        entries: requested.entries.filter(
          (entry) => resolve(entry.sourcePath) === resolve(ownedTarget)
        )
      },
      backupStore: store,
      expectedCurrentHashes: operationHashes
    });

    await expect(readFile(ownedTarget, "utf8")).resolves.toBe("# Original owned\n");
    await expect(readFile(externalTarget, "utf8"))
      .resolves.toBe("# Newer external edit\n");
  });

  it("deletes only the validated backup directory", async () => {
    const paths = await makePaths();
    const store = createBackupStore(paths, {
      now: () => new Date("2026-06-30T00:00:00.000Z")
    });
    const manifest = await store.createBackup([]);

    await store.deleteBackup(manifest.id);

    await expect(store.listBackups()).resolves.toEqual([]);
    await expect(store.deleteBackup("../../outside")).rejects.toThrow();
  });
});
