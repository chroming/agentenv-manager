import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createBackupStore } from "../../src/main/backupStore";
import { createPaths } from "../../src/main/paths";
import { createGitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { createGitSyncTransport } from "../../src/main/workspaceSync/gitSyncTransport";
import { createPortableWorkspaceCodec } from "../../src/main/workspaceSync/portableWorkspaceCodec";
import type { PortableWorkspaceManifest } from "../../src/main/workspaceSync/portableSchemas";
import { validatePortableWorkspace } from "../../src/main/workspaceSync/portableWorkspaceValidator";
import {
  materializeMergedWorkspace,
  planWorkspaceSync,
  type WorkspaceSnapshotDescriptor
} from "../../src/main/workspaceSync/syncPlanner";
import { createWorkspaceSyncTransaction } from "../../src/main/workspaceSync/workspaceSyncTransaction";
import { createWorkspaceSyncService } from "../../src/main/workspaceSync/workspaceSyncService";
import { createWorkspaceSyncStateStore, parseWorkspaceSyncConnection } from "../../src/main/workspaceSync/syncStateStore";
import { toPortableOnlineLocator } from "../../src/main/workspaceSync/portableLocation";
import { canonicalJson, hashJson, hashPortableTree, snapshotHashFor } from "../../src/main/workspaceSync/workspaceSnapshotHasher";

const execFileAsync = promisify(execFile);
let roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  roots = [];
});

const tempRoot = async (prefix: string) => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

const writeSnapshot = async (root: string, input: {
  workspaceId?: string;
  profileName?: string;
  instructions?: string;
  skillContent?: string;
  sources?: Array<{
    formatVersion: 1;
    id: string;
    canonicalLink: string;
    repository: string;
    ref: string;
    directory: string;
    indexManifestPath?: string;
  }>;
} = {}): Promise<WorkspaceSnapshotDescriptor> => {
  const profileRoot = join(root, "workspace", "profiles", "daily");
  const skillRoot = join(root, "workspace", "skills", "review", "content");
  await Promise.all([mkdir(profileRoot, { recursive: true }), mkdir(skillRoot, { recursive: true })]);
  const profile = {
    id: "daily",
    name: input.profileName ?? "Daily",
    description: "Default",
    createdAt: "2026-07-20T00:00:00.000Z",
    version: 2 as const
  };
  const resources = { skills: [{ libraryId: "review", targetName: "review", enabled: true }], mcpByTarget: {} };
  const instructions = input.instructions ?? "# Agent\n";
  const metadata = {
    formatVersion: 1 as const,
    id: "review",
    globallyEnabled: true,
    updatePolicy: "untracked" as const,
    sourceType: "local" as const
  };
  const sourceData = { formatVersion: 1 as const, sources: input.sources ?? [] };
  await Promise.all([
    writeFile(join(profileRoot, "profile.json"), canonicalJson(profile)),
    writeFile(join(profileRoot, "INSTRUCTIONS.md"), instructions),
    writeFile(join(profileRoot, "resources.json"), canonicalJson(resources)),
    writeFile(join(skillRoot, "SKILL.md"), input.skillContent ?? "---\nname: review\ndescription: Review code\n---\n"),
    writeFile(join(root, "workspace", "skills", "review", "metadata.json"), canonicalJson(metadata)),
    writeFile(join(root, "workspace", "skill-sources.json"), canonicalJson(sourceData))
  ]);
  const profileSections = {
    manifest: hashJson(profile),
    instructions: hashJson(instructions),
    resources: hashJson(resources)
  };
  const skillSections = {
    content: await hashPortableTree(skillRoot),
    metadata: hashJson(metadata)
  };
  const unsigned = {
    formatVersion: 1 as const,
    workspaceId: input.workspaceId ?? "11111111-1111-4111-8111-111111111111",
    profileHashes: { daily: { ...profileSections, total: hashJson(profileSections) } },
    skillHashes: { review: { ...skillSections, total: hashJson(skillSections) } },
    sourcesHash: hashJson(sourceData)
  };
  const manifest: PortableWorkspaceManifest = { ...unsigned, snapshotHash: snapshotHashFor(unsigned) };
  await writeFile(join(root, "agentenv-sync.json"), canonicalJson(manifest));
  return { root, manifest };
};

describe("Workspace Sync", () => {
  it("accepts SSH identities but rejects embedded HTTPS credentials and option-like repositories", () => {
    expect(parseWorkspaceSyncConnection({
      repository: "ssh://git@example.com/team/workspace.git",
      branch: "main"
    }).repository).toContain("git@example.com");
    expect(() => parseWorkspaceSyncConnection({
      repository: "https://token@example.com/team/workspace.git",
      branch: "main"
    })).toThrow("credentials");
    expect(() => parseWorkspaceSyncConnection({
      repository: "--upload-pack=malicious",
      branch: "main"
    })).toThrow();
    expect(() => parseWorkspaceSyncConnection({
      repository: "ftp://example.com/team/workspace.git",
      branch: "main"
    })).toThrow("not supported");
  });

  it("combines changes to different Profile sections without a conflict", async () => {
    const base = await writeSnapshot(await tempRoot("agentenv-sync-base-"));
    const local = await writeSnapshot(await tempRoot("agentenv-sync-local-"), { instructions: "# Local instructions\n" });
    const remote = await writeSnapshot(await tempRoot("agentenv-sync-remote-"), { profileName: "Remote Daily" });
    const destination = await tempRoot("agentenv-sync-merged-");
    const plan = planWorkspaceSync({ base, local, remote, baseRevision: "base", remoteRevision: "remote" });

    expect(plan.review.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "profile:daily:instructions", direction: "local" }),
      expect.objectContaining({ key: "profile:daily:manifest", direction: "remote" })
    ]));
    expect(plan.review.changes.some((change) => change.direction === "conflict")).toBe(false);

    const merged = await materializeMergedWorkspace({ plan, local, remote, destination });
    await expect(validatePortableWorkspace(merged.root)).resolves.toBeDefined();
    expect(JSON.parse(await readFile(join(destination, "workspace", "profiles", "daily", "profile.json"), "utf8")).name).toBe("Remote Daily");
    await expect(readFile(join(destination, "workspace", "profiles", "daily", "INSTRUCTIONS.md"), "utf8")).resolves.toBe("# Local instructions\n");
  });

  it("requires an explicit choice when both Macs change the same section", async () => {
    const base = await writeSnapshot(await tempRoot("agentenv-sync-base-"));
    const local = await writeSnapshot(await tempRoot("agentenv-sync-local-"), { instructions: "# Local\n" });
    const remote = await writeSnapshot(await tempRoot("agentenv-sync-remote-"), { instructions: "# Remote\n" });
    const plan = planWorkspaceSync({ base, local, remote });
    const conflict = plan.review.changes.find((change) => change.key === "profile:daily:instructions");

    expect(conflict?.direction).toBe("conflict");
    await expect(materializeMergedWorkspace({
      plan,
      local,
      remote,
      destination: await tempRoot("agentenv-sync-conflict-")
    })).rejects.toThrow("needs a choice");
  });

  it("rejects symbolic links before importing a remote snapshot", async () => {
    const snapshot = await writeSnapshot(await tempRoot("agentenv-sync-malicious-"));
    await symlink("/etc/passwd", join(snapshot.root, "workspace", "skills", "review", "content", "escape"));

    await expect(validatePortableWorkspace(snapshot.root)).rejects.toThrow("symbolic links");
  });

  it("rejects internal ownership metadata hidden inside portable Skill content", async () => {
    const snapshot = await writeSnapshot(await tempRoot("agentenv-sync-reserved-"));
    await writeFile(
      join(snapshot.root, "workspace", "skills", "review", "content", ".agentenv-owner.json"),
      "{}\n"
    );

    await expect(validatePortableWorkspace(snapshot.root)).rejects.toThrow("reserved AgentEnv data");
  });

  it("hashes portable content independently of host executable bits", async () => {
    const root = await tempRoot("agentenv-sync-mode-");
    const script = join(root, "script.sh");
    await writeFile(script, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(script, 0o644);
    const regularHash = await hashPortableTree(root);
    await chmod(script, 0o755);

    await expect(hashPortableTree(root)).resolves.toBe(regularHash);
  });

  it("rejects machine-local repository locators in an incoming portable snapshot", async () => {
    const snapshot = await writeSnapshot(await tempRoot("agentenv-sync-local-locator-"));
    const metadataPath = join(snapshot.root, "workspace", "skills", "review", "metadata.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, canonicalJson({
      ...metadata,
      sourceType: "git",
      source: "/Users/other/private-skills",
      updatePolicy: "tracked"
    }));

    await expect(validatePortableWorkspace(snapshot.root)).rejects.toThrow("machine-local");
  });

  it("excludes machine-local source paths from a portable Skill", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-codec-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    const skillPath = join(appDataRoot, "skills-library", "local-only");
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "---\nname: local-only\ndescription: Local\n---\n");
    const destination = join(appDataRoot, "export");
    const codec = createPortableWorkspaceCodec({
      paths,
      profileStore: { listProfiles: async () => [] } as never,
      skillLibraryStore: {
        listSkills: async () => [{
          id: "local-only",
          name: "local-only",
          description: "Local",
          path: skillPath,
          sourceType: "git",
          source: "/Users/other/private-skills",
          updatePolicy: "tracked",
          contentHash: "local",
          updatedAt: "2026-07-20T00:00:00.000Z",
          upstream: { kind: "git", locator: "/Users/other/private-skills", ref: "main" }
        }]
      } as never
    });

    await codec.exportSnapshot(destination, "11111111-1111-4111-8111-111111111111");
    const metadata = JSON.parse(await readFile(join(destination, "workspace", "skills", "local-only", "metadata.json"), "utf8"));

    expect(metadata).toMatchObject({ sourceType: "local", updatePolicy: "untracked" });
    expect(metadata).not.toHaveProperty("source");
    expect(metadata).not.toHaveProperty("upstream");
    expect(toPortableOnlineLocator("../private-skills")).toBeUndefined();
  });

  it("validates the portable Skill sources emitted by its own exporter", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-source-codec-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(paths.skillSourcesPath, canonicalJson({
      formatVersion: 1,
      sources: [{
        formatVersion: 1,
        id: "source-remote",
        kind: "repository",
        canonicalLink: "https://github.com/example/skills/tree/main/skills",
        repository: "https://github.com/example/skills.git",
        ref: "main",
        directory: "skills",
        automaticChecks: false,
        sourceSubpath: "legacy-extra-field",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-21T00:00:00.000Z"
      }]
    }));
    const destination = join(appDataRoot, "export");
    const codec = createPortableWorkspaceCodec({
      paths,
      profileStore: { listProfiles: async () => [] } as never,
      skillLibraryStore: { listSkills: async () => [] } as never
    });

    await codec.exportSnapshot(destination, "11111111-1111-4111-8111-111111111111");

    await expect(validatePortableWorkspace(destination)).resolves.toBeDefined();
    const sourceData = JSON.parse(
      await readFile(join(destination, "workspace", "skill-sources.json"), "utf8")
    );
    expect(sourceData.sources[0]).toMatchObject({
      id: "source-remote",
      kind: "repository",
      automaticChecks: false
    });
    expect(sourceData.sources[0]).not.toHaveProperty("sourceSubpath");
  });

  it("backs up and replaces Profiles, Skills, and sources as one recoverable operation", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-transaction-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    await Promise.all([
      mkdir(join(paths.profilesDir, "old"), { recursive: true }),
      mkdir(join(paths.skillsLibraryDir, "old"), { recursive: true }),
      mkdir(paths.targetStatesDir, { recursive: true })
    ]);
    await writeFile(join(paths.profilesDir, "old", "marker"), "old");
    await writeFile(join(paths.skillsLibraryDir, "old", "SKILL.md"), "old");
    await writeFile(join(paths.targetStatesDir, "opencode.json"), "device-local target state\n");
    await writeFile(paths.skillSourcesPath, canonicalJson({
      formatVersion: 1,
      sources: [{
        formatVersion: 1,
        id: "source-local",
        canonicalLink: "/Users/me/private-skills#ref=main",
        repository: "/Users/me/private-skills",
        ref: "main",
        directory: "",
        createdAt: "2026-07-20T00:00:00.000Z",
        updatedAt: "2026-07-20T00:00:00.000Z"
      }]
    }));
    const snapshot = await writeSnapshot(await tempRoot("agentenv-sync-candidate-"), {
      sources: [{
        formatVersion: 1,
        id: "source-remote",
        canonicalLink: "https://github.com/example/skills/tree/main/skills",
        repository: "https://github.com/example/skills.git",
        ref: "main",
        directory: "skills",
        indexManifestPath: "suite/llms.txt"
      }]
    });
    const transaction = createWorkspaceSyncTransaction({ paths, backupStore: createBackupStore(paths) });

    const result = await transaction.apply(snapshot.root);

    expect(result.backupId).toBeTruthy();
    await expect(readFile(join(paths.profilesDir, "daily", "INSTRUCTIONS.md"), "utf8")).resolves.toBe("# Agent\n");
    await expect(readFile(join(paths.skillsLibraryDir, "review", "SKILL.md"), "utf8")).resolves.toContain("Review code");
    await expect(readFile(join(paths.targetStatesDir, "opencode.json"), "utf8"))
      .resolves.toBe("device-local target state\n");
    const sources = JSON.parse(await readFile(paths.skillSourcesPath, "utf8")).sources;
    expect(sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "source-local", repository: "/Users/me/private-skills" }),
      expect.objectContaining({
        id: "source-remote",
        formatVersion: 1,
        indexManifestPath: "suite/llms.txt"
      })
    ]));
    await expect(transaction.isRecoveryRequired()).resolves.toBe(false);

    await transaction.restore(result.backupId);
    await expect(readFile(join(paths.profilesDir, "old", "marker"), "utf8")).resolves.toBe("old");
    expect(JSON.parse(await readFile(paths.skillSourcesPath, "utf8")).sources).toEqual([
      expect.objectContaining({ id: "source-local" })
    ]);
  });

  it("restores a Workspace root that was a directory link", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-link-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    const linkedProfiles = join(appDataRoot, "linked-profiles");
    await Promise.all([
      mkdir(join(linkedProfiles, "old"), { recursive: true }),
      mkdir(join(paths.skillsLibraryDir, "old"), { recursive: true })
    ]);
    await writeFile(join(linkedProfiles, "old", "marker"), "linked profile");
    await symlink(linkedProfiles, paths.profilesDir, "dir");
    await writeFile(join(paths.skillsLibraryDir, "old", "SKILL.md"), "old skill");
    await writeFile(
      paths.skillSourcesPath,
      canonicalJson({ formatVersion: 1, sources: [] })
    );
    const snapshot = await writeSnapshot(
      await tempRoot("agentenv-sync-link-candidate-")
    );
    const transaction = createWorkspaceSyncTransaction({
      paths,
      backupStore: createBackupStore(paths)
    });

    const result = await transaction.apply(snapshot.root);
    await transaction.restore(result.backupId);

    expect((await lstat(paths.profilesDir)).isSymbolicLink()).toBe(true);
    await expect(readlink(paths.profilesDir)).resolves.toBe(linkedProfiles);
    await expect(
      readFile(join(paths.profilesDir, "old", "marker"), "utf8")
    ).resolves.toBe("linked profile");
  }, 15_000);

  it("restores the pre-restore Workspace when a requested rollback fails partway", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-restore-safety-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    await mkdir(join(paths.profilesDir, "desired"), { recursive: true });
    await mkdir(join(paths.skillsLibraryDir, "desired"), { recursive: true });
    await writeFile(join(paths.profilesDir, "desired", "marker"), "desired profile");
    await writeFile(join(paths.skillsLibraryDir, "desired", "SKILL.md"), "desired skill");
    await writeFile(paths.skillSourcesPath, canonicalJson({ formatVersion: 1, sources: [] }));
    const realStore = createBackupStore(paths);
    const desired = await realStore.createBackup([
      paths.profilesDir,
      paths.skillsLibraryDir,
      paths.skillSourcesPath
    ], { operation: "workspace-sync" });
    await rm(paths.profilesDir, { recursive: true, force: true });
    await rm(paths.skillsLibraryDir, { recursive: true, force: true });
    await mkdir(join(paths.profilesDir, "current"), { recursive: true });
    await mkdir(join(paths.skillsLibraryDir, "current"), { recursive: true });
    await writeFile(join(paths.profilesDir, "current", "marker"), "current profile");
    await writeFile(join(paths.skillsLibraryDir, "current", "SKILL.md"), "current skill");
    const backupStore = {
      ...realStore,
      readBackup: async (id: string) => {
        const manifest = await realStore.readBackup(id);
        if (id !== desired.id) return manifest;
        return {
          ...manifest,
          entries: [
            ...manifest.entries,
            {
              sourcePath: join(appDataRoot, "unrelated.txt"),
              backupPath: join(appDataRoot, "missing-backup-payload"),
              missing: false as const,
              kind: "file" as const,
              sha256: "0".repeat(64)
            }
          ]
        };
      }
    };
    const transaction = createWorkspaceSyncTransaction({ paths, backupStore });

    await expect(transaction.restore(desired.id)).rejects.toThrow(
      "previous Workspace was restored from safety backup"
    );

    await expect(readFile(join(paths.profilesDir, "current", "marker"), "utf8"))
      .resolves.toBe("current profile");
    await expect(readFile(join(paths.skillsLibraryDir, "current", "SKILL.md"), "utf8"))
      .resolves.toBe("current skill");
    await expect(transaction.isRecoveryRequired()).resolves.toBe(false);
  });

  it.each(["profiles", "skills", "sources", "verify"] as const)(
    "restores every Workspace root after a failure at the %s stage",
    async (failurePhase) => {
      const appDataRoot = await tempRoot(`agentenv-sync-rollback-${failurePhase}-`);
      const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
      await Promise.all([
        mkdir(join(paths.profilesDir, "old"), { recursive: true }),
        mkdir(join(paths.skillsLibraryDir, "old"), { recursive: true })
      ]);
      await writeFile(join(paths.profilesDir, "old", "marker"), "old profile");
      await writeFile(join(paths.skillsLibraryDir, "old", "SKILL.md"), "old skill");
      await writeFile(paths.skillSourcesPath, canonicalJson({ formatVersion: 1, sources: [] }));
      const snapshot = await writeSnapshot(await tempRoot(`agentenv-sync-rollback-candidate-${failurePhase}-`));
      const transaction = createWorkspaceSyncTransaction({
        paths,
        backupStore: createBackupStore(paths),
        failureInjector: (phase) => {
          if (phase === failurePhase) throw new Error(`Injected ${phase} failure`);
        }
      });

      await expect(transaction.apply(snapshot.root)).rejects.toThrow(`Injected ${failurePhase} failure`);
      await expect(readFile(join(paths.profilesDir, "old", "marker"), "utf8")).resolves.toBe("old profile");
      await expect(readFile(join(paths.skillsLibraryDir, "old", "SKILL.md"), "utf8")).resolves.toBe("old skill");
      await expect(transaction.isRecoveryRequired()).resolves.toBe(false);
    }
  );

  it("preserves an untouched Workspace root changed externally after backup", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-concurrent-change-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    await Promise.all([
      mkdir(join(paths.profilesDir, "old"), { recursive: true }),
      mkdir(join(paths.skillsLibraryDir, "old"), { recursive: true })
    ]);
    await writeFile(join(paths.profilesDir, "old", "marker"), "old profile");
    const skillPath = join(paths.skillsLibraryDir, "old", "SKILL.md");
    await writeFile(skillPath, "old skill");
    await writeFile(paths.skillSourcesPath, canonicalJson({ formatVersion: 1, sources: [] }));
    const snapshot = await writeSnapshot(await tempRoot("agentenv-sync-concurrent-candidate-"));
    const transaction = createWorkspaceSyncTransaction({
      paths,
      backupStore: createBackupStore(paths),
      failureInjector: async (phase) => {
        if (phase === "profiles") await writeFile(skillPath, "external skill change");
      }
    });

    await expect(transaction.apply(snapshot.root)).rejects.toThrow(
      "Workspace path changed while Update was being prepared"
    );

    await expect(readFile(join(paths.profilesDir, "old", "marker"), "utf8"))
      .resolves.toBe("old profile");
    await expect(readFile(skillPath, "utf8")).resolves.toBe("external skill change");
    await expect(transaction.isRecoveryRequired()).resolves.toBe(false);
  });

  it("recovers an interrupted Workspace transaction during startup", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-startup-recovery-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    await mkdir(join(paths.profilesDir, "old"), { recursive: true });
    await mkdir(join(paths.skillsLibraryDir, "old"), { recursive: true });
    await writeFile(join(paths.profilesDir, "old", "marker"), "old profile");
    await writeFile(join(paths.skillsLibraryDir, "old", "SKILL.md"), "old skill");
    await writeFile(paths.skillSourcesPath, canonicalJson({ formatVersion: 1, sources: [] }));
    const store = createBackupStore(paths);
    const backup = await store.createBackup(
      [paths.profilesDir, paths.skillsLibraryDir, paths.skillSourcesPath],
      { operation: "workspace-sync" }
    );
    await rm(paths.profilesDir, { recursive: true, force: true });
    await rm(paths.skillsLibraryDir, { recursive: true, force: true });
    await writeFile(paths.workspaceSyncJournalPath, canonicalJson({
      formatVersion: 2,
      backupId: backup.id,
      createdAt: new Date().toISOString(),
      phase: "rollback-required",
      mutationHashes: {
        [resolve(paths.profilesDir)]: null,
        [resolve(paths.skillsLibraryDir)]: null
      }
    }));

    const transaction = createWorkspaceSyncTransaction({ paths, backupStore: store });
    await transaction.recover();

    await expect(readFile(join(paths.profilesDir, "old", "marker"), "utf8")).resolves.toBe("old profile");
    await expect(readFile(join(paths.skillsLibraryDir, "old", "SKILL.md"), "utf8")).resolves.toBe("old skill");
    await expect(transaction.isRecoveryRequired()).resolves.toBe(false);
  });

  it("preserves a Workspace root changed after its verified write", async () => {
    const appDataRoot = await tempRoot("agentenv-sync-post-write-change-");
    const paths = createPaths({ appDataRoot, homeDir: join(appDataRoot, "home") });
    await mkdir(join(paths.profilesDir, "old"), { recursive: true });
    await mkdir(join(paths.skillsLibraryDir, "old"), { recursive: true });
    await writeFile(join(paths.profilesDir, "old", "marker"), "old profile");
    await writeFile(join(paths.skillsLibraryDir, "old", "SKILL.md"), "old skill");
    await writeFile(paths.skillSourcesPath, canonicalJson({ formatVersion: 1, sources: [] }));
    const snapshot = await writeSnapshot(await tempRoot("agentenv-sync-post-write-candidate-"));
    const externalMarker = join(paths.profilesDir, "external-change");
    const transaction = createWorkspaceSyncTransaction({
      paths,
      backupStore: createBackupStore(paths),
      failureInjector: async (phase) => {
        if (phase !== "profiles") return;
        await writeFile(externalMarker, "new external data");
        throw new Error("Injected failure after external change");
      }
    });

    await expect(transaction.apply(snapshot.root)).rejects.toThrow(
      "Workspace update failed and needs recovery"
    );
    await expect(readFile(externalMarker, "utf8")).resolves.toBe("new external data");
    await expect(transaction.isRecoveryRequired()).resolves.toBe(true);
  });

  it("publishes and fetches through a real local bare Git repository", async () => {
    const root = await tempRoot("agentenv-sync-git-");
    const bare = join(root, "remote.git");
    await execFileAsync("/usr/bin/git", ["init", "--bare", bare]);
    const snapshot = await writeSnapshot(join(root, "snapshot"));
    const runner = createGitCommandRunner({ executablePath: "/usr/bin/git" });
    const transport = createGitSyncTransport(runner);

    const revision = await transport.publish({
      connection: { repository: bare, branch: "main" },
      snapshotRoot: snapshot.root,
      workDir: join(root, "publish")
    });
    const fetched = await transport.fetch({ repository: bare, branch: "main" }, join(root, "fetched"));
    const unchangedRevision = await transport.publish({
      connection: { repository: bare, branch: "main" },
      snapshotRoot: snapshot.root,
      expectedRevision: revision,
      workDir: join(root, "publish-unchanged")
    });

    expect(revision).toMatch(/^[a-f0-9]{40}$/);
    expect(fetched.revision).toBe(revision);
    expect(unchangedRevision).toBe(revision);
    await expect(validatePortableWorkspace(fetched.snapshotRoot!)).resolves.toBeDefined();

    const external = join(root, "external");
    await execFileAsync("/usr/bin/git", ["clone", bare, external]);
    await execFileAsync("/usr/bin/git", ["config", "user.name", "Test"], { cwd: external });
    await execFileAsync("/usr/bin/git", ["config", "user.email", "test@example.com"], { cwd: external });
    await writeFile(join(external, "README.md"), "Unrelated repository content\n");
    await execFileAsync("/usr/bin/git", ["add", "README.md"], { cwd: external });
    await execFileAsync("/usr/bin/git", ["commit", "-m", "External change"], { cwd: external });
    await execFileAsync("/usr/bin/git", ["push", "origin", "main"], { cwd: external });
    await expect(transport.publish({
      connection: { repository: bare, branch: "main" },
      snapshotRoot: snapshot.root,
      expectedRevision: revision,
      workDir: join(root, "stale-publish")
    })).rejects.toThrow("changed");

    await execFileAsync("/usr/bin/git", ["checkout", "--orphan", "rewritten"], { cwd: external });
    await execFileAsync("/usr/bin/git", ["add", "-A"], { cwd: external });
    await execFileAsync("/usr/bin/git", ["commit", "--allow-empty", "-m", "Rewritten history"], { cwd: external });
    await execFileAsync("/usr/bin/git", ["push", "--force", "origin", "HEAD:main"], { cwd: external });
    await expect(transport.fetch(
      { repository: bare, branch: "main" },
      join(root, "rewritten-fetch"),
      revision
    )).rejects.toThrow("history was rewritten");
    transport.dispose();
  }, 15_000);

  it("keeps a correct three-way base across two isolated Macs", async () => {
    const root = await tempRoot("agentenv-sync-two-macs-");
    const bare = join(root, "remote.git");
    await execFileAsync("/usr/bin/git", ["init", "--bare", bare]);
    const createDevice = async (name: string, initialInstructions: string) => {
      const paths = createPaths({
        appDataRoot: join(root, name, "data"),
        homeDir: join(root, name, "home"),
        repositoryCacheDir: join(root, name, "cache", "repositories"),
        workspaceSyncCacheDir: join(root, name, "cache", "workspace-sync")
      });
      let instructions = initialInstructions;
      const runner = createGitCommandRunner({ executablePath: "/usr/bin/git" });
      const transport = createGitSyncTransport(runner);
      const service = createWorkspaceSyncService({
        paths,
        codec: {
          exportSnapshot: async (destination, workspaceId) =>
            (await writeSnapshot(destination, { workspaceId, instructions })).manifest
        },
        stateStore: createWorkspaceSyncStateStore(paths),
        transaction: {
          recover: async () => undefined,
          isRecoveryRequired: async () => false,
          apply: async (snapshotRoot) => {
            instructions = await readFile(join(snapshotRoot, "workspace", "profiles", "daily", "INSTRUCTIONS.md"), "utf8");
            return { backupId: `${name}-backup` };
          },
          restore: async () => undefined
        },
        loadTransport: async () => transport,
        targetPathsProvider: async () => [],
        findManagedInstallPaths: async () => []
      });
      return { service, getInstructions: () => instructions, setInstructions: (value: string) => { instructions = value; } };
    };

    const first = await createDevice("first", "# Shared\n");
    expect((await first.service.connect({ repository: bare, branch: "main" })).kind).toBe("local-changes");
    expect((await first.service.publish()).status.kind).toBe("up-to-date");

    const second = await createDevice("second", "# Shared\n");
    expect((await second.service.connect({ repository: bare, branch: "main" })).kind).toBe("up-to-date");
    first.setInstructions("# Changed on first\n");
    expect((await first.service.check()).kind).toBe("local-changes");
    await first.service.publish();

    expect((await second.service.check()).kind).toBe("remote-changes");
    const review = await second.service.review();
    expect(review.changes).toContainEqual(expect.objectContaining({
      key: "profile:daily:instructions",
      direction: "remote"
    }));
    const updated = await second.service.update({ expectedRemoteRevision: review.remoteRevision });
    expect(updated.status.kind).toBe("up-to-date");
    expect(second.getInstructions()).toBe("# Changed on first\n");
    first.service.dispose();
    second.service.dispose();
  }, 15_000);

  it("keeps the existing connection when a replacement repository cannot be checked", async () => {
    const root = await tempRoot("agentenv-sync-reconnect-");
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const remote = await writeSnapshot(join(root, "remote"));
    const stateStore = createWorkspaceSyncStateStore(paths);
    const service = createWorkspaceSyncService({
      paths,
      codec: {
        exportSnapshot: async (destination, workspaceId) =>
          (await writeSnapshot(destination, { workspaceId })).manifest
      },
      stateStore,
      transaction: {
        recover: async () => undefined,
        isRecoveryRequired: async () => false,
        apply: async () => ({ backupId: "unused" }),
        restore: async () => undefined
      },
      loadTransport: async () => ({
        fetch: async (connection) => {
          if (connection.repository.includes("unavailable")) {
            throw new Error("Repository is unavailable");
          }
          return { revision: "remote-revision", snapshotRoot: remote.root };
        },
        publish: async () => "unused",
        cancel: () => undefined,
        dispose: () => undefined
      }),
      targetPathsProvider: async () => [],
      findManagedInstallPaths: async () => []
    });

    await expect(service.connect({
      repository: "/tmp/working.git",
      branch: "main"
    })).resolves.toMatchObject({
      kind: "up-to-date",
      connection: { repository: "/tmp/working.git", branch: "main" }
    });

    await expect(service.connect({
      repository: "/tmp/unavailable.git",
      branch: "main"
    })).rejects.toThrow("Repository is unavailable");
    await expect(stateStore.read()).resolves.toMatchObject({
      repository: "/tmp/working.git",
      branch: "main"
    });
    await expect(service.readStatus()).resolves.toMatchObject({
      connection: { repository: "/tmp/working.git", branch: "main" }
    });
    service.dispose();
  });

  it("does not expose internal hash errors when a connected remote snapshot is invalid", async () => {
    const root = await tempRoot("agentenv-sync-invalid-remote-");
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const remote = await writeSnapshot(join(root, "remote"));
    const service = createWorkspaceSyncService({
      paths,
      codec: {
        exportSnapshot: async (destination, workspaceId) =>
          (await writeSnapshot(destination, { workspaceId })).manifest
      },
      stateStore: createWorkspaceSyncStateStore(paths),
      transaction: {
        recover: async () => undefined,
        isRecoveryRequired: async () => false,
        apply: async () => ({ backupId: "unused" }),
        restore: async () => undefined
      },
      loadTransport: async () => ({
        fetch: async () => ({ revision: "remote-revision", snapshotRoot: remote.root }),
        publish: async () => "unused",
        cancel: () => undefined,
        dispose: () => undefined
      }),
      targetPathsProvider: async () => [],
      findManagedInstallPaths: async () => []
    });

    await expect(service.connect({ repository: "/tmp/remote.git", branch: "main" }))
      .resolves.toMatchObject({ kind: "up-to-date" });
    await writeFile(
      join(remote.root, "workspace", "skill-sources.json"),
      canonicalJson({ formatVersion: 1, sources: [{ unexpected: true }] })
    );

    const status = await service.check();

    expect(status).toMatchObject({
      kind: "error",
      issue: "remote-snapshot-invalid",
      message: "The remote Workspace snapshot could not be verified. This device was not changed."
    });
    expect(status.message).not.toContain("hash");
    service.dispose();
  });

  it("restores Workspace content and clears working state when Sync state cannot be committed", async () => {
    const root = await tempRoot("agentenv-sync-state-failure-");
    const paths = createPaths({ appDataRoot: join(root, "data"), homeDir: join(root, "home") });
    const remote = await writeSnapshot(join(root, "remote"), { instructions: "# Remote\n" });
    const underlyingStore = createWorkspaceSyncStateStore(paths);
    let failStateWrites = false;
    let restored = false;
    const service = createWorkspaceSyncService({
      paths,
      codec: {
        exportSnapshot: async (destination, workspaceId) =>
          (await writeSnapshot(destination, { workspaceId, instructions: "# Local\n" })).manifest
      },
      stateStore: {
        ...underlyingStore,
        write: async (state) => {
          if (failStateWrites) throw new Error("State disk is read-only");
          await underlyingStore.write(state);
        }
      },
      transaction: {
        recover: async () => undefined,
        isRecoveryRequired: async () => false,
        apply: async () => {
          failStateWrites = true;
          return { backupId: "workspace-backup" };
        },
        restore: async (backupId) => {
          expect(backupId).toBe("workspace-backup");
          restored = true;
        }
      },
      loadTransport: async () => ({
        fetch: async () => ({ revision: "remote-revision", snapshotRoot: remote.root }),
        publish: async () => "unused",
        cancel: () => undefined,
        dispose: () => undefined
      }),
      targetPathsProvider: async () => [],
      findManagedInstallPaths: async () => []
    });

    await service.connect({ repository: "/tmp/remote.git", branch: "main" });
    const review = await service.review();
    const conflict = review.changes.find((change) => change.direction === "conflict");
    expect(conflict).toBeDefined();

    await expect(service.update({
      expectedRemoteRevision: review.remoteRevision,
      conflictChoices: { [conflict!.key]: "remote" }
    })).rejects.toThrow("read-only");

    expect(restored).toBe(true);
    expect((await service.readStatus()).working).toBeUndefined();
    service.dispose();
  });
});
