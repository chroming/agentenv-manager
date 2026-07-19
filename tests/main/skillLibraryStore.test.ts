import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaths } from "../../src/main/paths";
import { findExecutable } from "../../src/main/executableDiscovery";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";
import { createGitCliSkillSource } from "../../src/main/skillSources/gitCliSource";
import { createGitCommandRunner } from "../../src/main/skillSources/gitCommandRunner";
import { createGitRepositoryCache } from "../../src/main/skillSources/gitRepositoryCache";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import { buildSkillCleanupGroups } from "../../src/shared/skillCleanup";
import type { ProfileDetail, SaveProfileInput } from "../../src/shared/types";
import { createGitTestRepository } from "./skillSources/gitTestRepository";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

describe("skill library store", () => {
  it("rejects malformed YAML frontmatter before copying a local skill", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data") });
    const sourceDir = join(root, "broken-skill");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: [broken\n---\n# Broken\n");
    const store = createSkillLibraryStore(paths);

    await expect(store.importSkill({ sourcePath: sourceDir })).rejects.toThrow(
      "Skill frontmatter is invalid"
    );
    await expect(readFile(join(paths.skillsLibraryDir, "broken-skill", "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("previews same-name imports and requires an explicit reuse, replace, or keep-both decision", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data") });
    const existingDir = join(root, "existing-reviewer");
    const incomingDir = join(root, "incoming-reviewer");
    await mkdir(existingDir, { recursive: true });
    await mkdir(incomingDir, { recursive: true });
    await writeFile(
      join(existingDir, "SKILL.md"),
      "---\nname: reviewer\ndescription: Existing.\nmetadata:\n  version: '1.0'\n---\n# Existing\n"
    );
    const incomingContent =
      "---\nname: reviewer\ndescription: Incoming.\nversion: 2.0.0\n---\n# Incoming\n";
    await writeFile(join(incomingDir, "SKILL.md"), incomingContent);
    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: existingDir, id: "reviewer" });

    const preview = await store.previewImport({
      kind: "local",
      input: { sourcePath: incomingDir, id: "reviewer" }
    });
    expect(preview).toMatchObject({
      incoming: { name: "reviewer", version: "2.0.0", versionSource: "version" },
      suggestedId: "reviewer-2",
      conflicts: [
        {
          existing: {
            id: "reviewer",
            version: "1.0",
            versionSource: "metadata.version"
          },
          identical: false
        }
      ]
    });
    expect(preview.conflicts[0].changes[0]).toMatchObject({ path: "SKILL.md" });
    await expect(
      store.importSkill({ sourcePath: incomingDir, id: "reviewer" })
    ).rejects.toThrow("Skill name or ID already exists");
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toContain("# Existing");

    await writeFile(join(incomingDir, "SKILL.md"), `${incomingContent}\nChanged after preview.\n`);
    await expect(
      store.importSkill({
        sourcePath: incomingDir,
        id: "reviewer",
        expectedContentHash: preview.incoming.contentHash,
        conflictResolution: { action: "keep-both", id: "reviewer-2" }
      })
    ).rejects.toThrow("changed after the import preview");
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer-2", "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(incomingDir, "SKILL.md"), incomingContent);

    const kept = await store.importSkill({
      sourcePath: incomingDir,
      id: "reviewer",
      expectedContentHash: preview.incoming.contentHash,
      conflictResolution: { action: "keep-both", id: "reviewer-2" }
    });
    expect(kept).toMatchObject({ id: "reviewer-2", version: "2.0.0" });

    const duplicatePreview = await store.previewImport({
      kind: "local",
      input: { sourcePath: incomingDir, id: "reviewer" }
    });
    const identical = duplicatePreview.conflicts.find((item) => item.existing.id === "reviewer-2");
    expect(identical?.identical).toBe(true);
    const reused = await store.importSkill({
      sourcePath: incomingDir,
      id: "reviewer",
      expectedContentHash: duplicatePreview.incoming.contentHash,
      conflictResolution: { action: "reuse", existingId: "reviewer-2" }
    });
    expect(reused.id).toBe("reviewer-2");

    const replaced = await store.importSkill({
      sourcePath: incomingDir,
      id: "reviewer",
      expectedContentHash: duplicatePreview.incoming.contentHash,
      conflictResolution: { action: "replace", existingId: "reviewer" }
    });
    expect(replaced).toMatchObject({ id: "reviewer", version: "2.0.0" });
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toContain("# Incoming");
    expect((await store.listCleanupBackups()).some((backup) => backup.libraryId === "reviewer"))
      .toBe(true);
  });

  it("offers a source-only update when identical content gains a GitHub source", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data") });
    const sourceDir = join(root, "reviewer");
    const content = "---\nname: reviewer\ndescription: Review changes.\n---\n# Reviewer\n";
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), content);
    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer" });
    const upstream = {
      kind: "github" as const,
      locator: "https://github.com/acme/skills/tree/main/reviewer",
      ref: "main",
      subpath: "reviewer",
      revision: "abc123"
    };

    const preview = await store.previewImport({
      kind: "local",
      input: { sourcePath: sourceDir, id: "reviewer", upstream }
    });
    expect(preview.conflicts[0]).toMatchObject({
      contentIdentical: true,
      sourceUpdateAvailable: true,
      identical: false,
      changes: []
    });
    expect(preview.incoming).toMatchObject({
      sourceType: "github",
      source: "https://github.com/acme/skills/tree/main/reviewer"
    });

    const updated = await store.importSkill({
      sourcePath: sourceDir,
      id: "reviewer",
      upstream,
      expectedContentHash: preview.incoming.contentHash,
      conflictResolution: { action: "update-source", existingId: "reviewer" }
    });
    expect(updated).toMatchObject({
      id: "reviewer",
      sourceType: "github",
      source: "https://github.com/acme/skills/tree/main/reviewer",
      updatePolicy: "tracked",
      remoteRevision: "abc123"
    });
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toBe(content);
  });

  it("detects Skills CLI directory links and imports an independent tracked copy", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const canonicalDir = join(paths.homeDir, ".agents", "skills", "reviewer");
    const targetSkillsDir = join(paths.homeDir, ".config", "opencode", "skills");
    const targetDir = join(targetSkillsDir, "reviewer");
    const lockPath = join(paths.homeDir, ".agents", ".skill-lock.json");
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(targetSkillsDir, { recursive: true });
    await writeFile(
      join(canonicalDir, "SKILL.md"),
      `---
name: Reviewer
description: >
  Review code from a shared
  Skills CLI installation.
---
`
    );
    await symlink(canonicalDir, targetDir, "dir");
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 3,
        skills: {
          reviewer: {
            source: "acme/skills",
            sourceType: "github",
            sourceUrl: "https://github.com/acme/skills",
            ref: "main",
            skillPath: "skills/reviewer/SKILL.md",
            skillFolderHash: "tree-sha"
          }
        }
      })
    );
    const store = createSkillLibraryStore(paths, undefined, { skillsCliLockPaths: [lockPath] });

    const inventory = await store.scanInventory([
      {
        targetId: "opencode",
        configDir: dirname(targetSkillsDir),
        instructionsPath: "",
        configPath: "",
        skillsDir: targetSkillsDir
      }
    ]);

    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      id: "reviewer",
      name: "Reviewer",
      description: "Review code from a shared Skills CLI installation.",
      status: "external",
      externalOwnership: {
        manager: "skills-cli",
        confidence: "confirmed",
        state: "healthy"
      }
    });

    const imported = await store.importSkill({
      sourcePath: inventory[0].path,
      id: inventory[0].skillKey,
      upstream: inventory[0].externalOwnership?.upstream,
      provenance: {
        importedVia: "local-scan",
        externalManager: "skills-cli",
        externalLockPath: lockPath
      }
    });

    expect(imported).toMatchObject({
      id: "reviewer",
      sourceType: "github",
      updatePolicy: "tracked",
      remoteRef: "main",
      provenance: {
        importedVia: "local-scan",
        externalManager: "skills-cli",
        externalLockPath: lockPath
      }
    });
    const representedInventory = await store.scanInventory([
      {
        targetId: "opencode",
        configDir: dirname(targetSkillsDir),
        instructionsPath: "",
        configPath: "",
        skillsDir: targetSkillsDir
      }
    ]);
    expect(representedInventory[0]).toMatchObject({
      status: "external",
      libraryId: "reviewer",
      contentMatchesLibrary: true
    });
    await rm(canonicalDir, { recursive: true, force: true });
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("Skills CLI installation");
  });

  it("keeps a broken Skills CLI link visible during scanning", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const targetSkillsDir = join(paths.homeDir, ".config", "opencode", "skills");
    const targetDir = join(targetSkillsDir, "missing-reviewer");
    const lockPath = join(paths.homeDir, ".agents", ".skill-lock.json");
    await mkdir(targetSkillsDir, { recursive: true });
    await mkdir(dirname(lockPath), { recursive: true });
    await symlink(join(paths.homeDir, ".agents", "skills", "missing-reviewer"), targetDir, "dir");
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 3,
        skills: {
          "missing-reviewer": {
            sourceType: "github",
            sourceUrl: "https://github.com/acme/skills",
            ref: "main",
            skillPath: "skills/missing-reviewer/SKILL.md",
            skillFolderHash: "missing"
          }
        }
      })
    );
    const store = createSkillLibraryStore(paths, undefined, { skillsCliLockPaths: [lockPath] });

    const inventory = await store.scanInventory([
      {
        targetId: "opencode",
        configDir: dirname(targetSkillsDir),
        instructionsPath: "",
        configPath: "",
        skillsDir: targetSkillsDir
      }
    ]);

    expect(inventory[0]).toMatchObject({
      id: "missing-reviewer",
      status: "external",
      contentHash: "",
      externalOwnership: { state: "broken-link" }
    });
  });

  it("keeps an unclaimed broken Skill link visible and non-automatic", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const targetSkillsDir = join(paths.homeDir, ".config", "opencode", "skills");
    const targetDir = join(targetSkillsDir, "missing-local");
    await mkdir(targetSkillsDir, { recursive: true });
    await symlink(join(root, "removed-source"), targetDir, "dir");
    const store = createSkillLibraryStore(paths);

    const inventory = await store.scanInventory([{
      targetId: "opencode",
      configDir: dirname(targetSkillsDir),
      instructionsPath: "",
      configPath: "",
      skillsDir: targetSkillsDir
    }]);
    const group = buildSkillCleanupGroups(inventory)[0];

    expect(inventory[0]).toMatchObject({
      id: "missing-local",
      status: "unmanaged",
      runtimeAvailability: "unknown",
      runtimeIssues: [expect.objectContaining({ code: "unreadable-skill" })]
    });
    expect(group).toMatchObject({
      state: "broken",
      resolution: "manual",
      presentation: { state: "unavailable", action: "review-details" }
    });
  });
  it("lists reusable skills from the central library directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: root });
    await mkdir(join(paths.skillsLibraryDir, "reviewer"), { recursive: true });
    await writeFile(
      join(paths.skillsLibraryDir, "reviewer", "SKILL.md"),
      "---\nname: reviewer\ndescription: Review code carefully.\n---\n\n# Reviewer\n",
      "utf8"
    );
    await mkdir(join(paths.skillsLibraryDir, "missing-md"), { recursive: true });
    await writeFile(join(paths.skillsLibraryDir, "missing-md", "README.md"), "# Nope\n");

    const store = createSkillLibraryStore(paths);
    const skills = await store.listSkills();

    expect(skills).toEqual([
      {
        id: "reviewer",
        name: "reviewer",
        description: "Review code carefully.",
        path: join(paths.skillsLibraryDir, "reviewer"),
        sourceType: "local",
        source: undefined,
        globallyEnabled: true,
        updatePolicy: "untracked",
        contentHash: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("# Reviewer");
  });

  it("keeps Claude Code plugin Skills external and read-only", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const homeDir = join(root, "home");
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir });
    const pluginDir = join(homeDir, ".claude", "plugins", "cache", "review-plugin");
    const pluginSkill = join(pluginDir, "skills", "reviewer");
    const targetSkill = join(homeDir, ".claude", "skills", "reviewer");
    await mkdir(join(pluginDir, ".claude-plugin"), { recursive: true });
    await mkdir(pluginSkill, { recursive: true });
    await mkdir(dirname(targetSkill), { recursive: true });
    await writeFile(join(pluginDir, ".claude-plugin", "plugin.json"), "{}\n");
    await writeFile(join(pluginSkill, "SKILL.md"), "---\nname: reviewer\n---\n# Reviewer\n");
    await symlink(pluginSkill, targetSkill);
    const targetPaths = createClaudeCodeTargetAdapter().createTargetPaths({ homeDir });
    const openCodePaths = createOpenCodeTargetAdapter().createTargetPaths({ homeDir });

    const inventory = await createSkillLibraryStore(paths).scanInventory([
      targetPaths,
      openCodePaths
    ]);

    expect(inventory).toEqual([
      expect.objectContaining({
        id: "reviewer",
        skillKey: "reviewer",
        status: "external",
        foundIn: ["claude-code", "opencode"],
        runtimeOwner: "external",
        externalOwnership: expect.objectContaining({
          manager: "claude-plugin",
          displayName: "Claude Code plugin",
          importable: false
        })
      })
    ]);
  });

  it("preserves per-Agent runtime state for one shared Skill copy", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const homeDir = join(root, "home");
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir });
    const sharedRoot = join(homeDir, ".agents", "skills");
    const sharedSkill = join(sharedRoot, "reviewer");
    await mkdir(sharedSkill, { recursive: true });
    await writeFile(join(sharedSkill, "SKILL.md"), "---\nname: reviewer\n---\n# Reviewer\n");
    const targetPaths = ["codex", "opencode"].map((targetId) => ({
      targetId,
      configDir: join(homeDir, `.${targetId}`),
      instructionsPath: join(homeDir, `.${targetId}`, "AGENTS.md"),
      configPath: join(homeDir, `.${targetId}`, "config.json"),
      skillsDir: sharedRoot,
      skillLocations: [{
        path: sharedRoot,
        role: "compatibility-runtime" as const,
        shared: true,
        scope: "shared" as const,
        scanDepth: "direct" as const,
        management: "observed" as const
      }]
    }));
    const store = createSkillLibraryStore(paths, undefined, {
      runtimeSnapshotProvider: async (target) => ({
        targetId: target.targetId,
        issues: [],
        observations: [{
          targetId: target.targetId,
          locationPath: sharedRoot,
          path: sharedSkill,
          runtimeName: "reviewer",
          deploymentName: "reviewer",
          scope: "shared",
          owner: "user",
          availability: target.targetId === "codex" ? "disabled" : "enabled",
          confidence: "verified",
          locationRole: "compatibility-runtime",
          shared: true,
          legacy: false,
          issues: []
        }]
      })
    });

    const inventory = await store.scanInventory(targetPaths);

    expect(inventory).toHaveLength(1);
    expect(inventory[0].foundIn).toEqual(["codex", "opencode"]);
    expect(inventory[0].runtimeStates).toEqual([
      expect.objectContaining({ targetId: "codex", availability: "disabled" }),
      expect.objectContaining({ targetId: "opencode", availability: "enabled" })
    ]);
  });

  it("imports unmanaged skills into the library without mutating the source directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "opencode", "skills", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: reviewer\ndescription: Source skill.\n---\n\n# Reviewer\n",
      "utf8"
    );
    await writeFile(join(sourceDir, "prompt.md"), "keep source intact\n", "utf8");

    const store = createSkillLibraryStore(paths);
    const imported = await store.importSkill({
      sourcePath: sourceDir,
      id: "shared-reviewer",
      sourceType: "local"
    });

    expect(imported).toMatchObject({
      id: "shared-reviewer",
      name: "reviewer",
      description: "Source skill.",
      sourceType: "local",
      source: sourceDir,
      updatePolicy: "untracked"
    });
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", "prompt.md"), "utf8")
    ).resolves.toBe("keep source intact\n");
    await expect(readFile(join(sourceDir, "prompt.md"), "utf8")).resolves.toBe(
      "keep source intact\n"
    );
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", ".agentenv-skill.json"), "utf8")
    ).resolves.toContain('"sourceType": "local"');
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", ".agentenv-skill.json"), "utf8")
    ).resolves.toContain(sourceDir);
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", ".agentenv-skill.json"), "utf8")
    ).resolves.toContain('"updateCheckEnabled": false');
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", ".agentenv-skill.json"), "utf8")
    ).resolves.toContain('"updatePolicy": "untracked"');
  });

  it("does not check a copied local import after the original source folder is removed", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "opencode", "skills", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n\n# Reviewer\n", "utf8");

    const store = createSkillLibraryStore(paths);
    await store.importSkill({
      sourcePath: sourceDir,
      id: "shared-reviewer",
      sourceType: "local"
    });
    await rm(sourceDir, { recursive: true, force: true });

    await expect(store.checkUpdates()).resolves.toEqual([]);
    await expect(store.previewUpdate("shared-reviewer")).resolves.toMatchObject({
      updateAvailable: false,
      errors: ["This skill is not tracked for updates"]
    });
  });

  it("defaults historical local sources to checks off without reading a missing path", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const libraryDir = join(paths.skillsLibraryDir, "legacy-local");
    const missingSource = join(root, "removed", "legacy-local");
    await mkdir(libraryDir, { recursive: true });
    await writeFile(join(libraryDir, "SKILL.md"), "---\nname: legacy-local\n---\n# Local\n", "utf8");
    await writeFile(
      join(libraryDir, ".agentenv-skill.json"),
      `${JSON.stringify({ sourceType: "local", source: missingSource }, null, 2)}\n`,
      "utf8"
    );

    const store = createSkillLibraryStore(paths);

    await expect(store.listSkills()).resolves.toEqual([
      expect.objectContaining({
        id: "legacy-local",
        source: missingSource,
        updatePolicy: "untracked"
      })
    ]);
    await expect(store.checkUpdates()).resolves.toEqual([]);
    await expect(
      store.setUpdatePolicy({ id: "legacy-local", policy: "tracked" })
    ).rejects.toThrow(`Skill source is missing SKILL.md: ${missingSource}`);
  });

  it("keeps repository sources tracked by default without checking disabled or untracked skills", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const fixtures = [
      {
        id: "disabled-git",
        metadata: {
          sourceType: "git",
          source: "git@code.example.test:agent/skills.git",
          remoteRef: "main",
          remotePath: "skills/reviewer",
          globallyEnabled: false
        }
      },
      {
        id: "untracked-git",
        metadata: {
          sourceType: "git",
          source: "ssh://git@code.example.test/agent/skills.git",
          updatePolicy: "untracked"
        }
      },
      {
        id: "legacy-github",
        metadata: {
          sourceType: "github",
          source: "https://github.com/example/skills/tree/main/reviewer",
          globallyEnabled: false
        }
      }
    ] as const;

    for (const fixture of fixtures) {
      const skillDir = join(paths.skillsLibraryDir, fixture.id);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, "SKILL.md"),
        `---\nname: ${fixture.id}\n---\n# ${fixture.id}\n`,
        "utf8"
      );
      await writeFile(
        join(skillDir, ".agentenv-skill.json"),
        `${JSON.stringify(fixture.metadata, null, 2)}\n`,
        "utf8"
      );
    }

    const fetchImpl = vi.fn(async () => {
      throw new Error("disabled and untracked sources must not contact a remote");
    });
    const store = createSkillLibraryStore(paths, undefined, { fetch: fetchImpl });

    await expect(store.listSkills()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "disabled-git",
          sourceType: "git",
          updatePolicy: "tracked",
          globallyEnabled: false
        }),
        expect.objectContaining({ id: "untracked-git", updatePolicy: "untracked" }),
        expect.objectContaining({ id: "legacy-github", updatePolicy: "tracked" })
      ])
    );
    await expect(store.checkUpdates()).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("imports and updates a system Git skill without modifying a deployed Target copy", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-git-"));
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: join(root, "home"),
      repositoryCacheDir: join(root, "cache", "repositories")
    });
    const repository = await createGitTestRepository(root, {
      "README.md": "Initial notes\n",
      "skills/review/SKILL.md":
        "---\nname: repository-review\ndescription: Review code.\nversion: 1.0.0\n---\n# Review\n",
      "skills/review/prompt.md": "Review carefully.\n"
    });
    const executablePath = await findExecutable("git", { homeDir: paths.homeDir });
    if (!executablePath) throw new Error("Git is required for repository source tests");
    const runner = createGitCommandRunner({ executablePath });
    const repositorySource = createGitCliSkillSource({
      runner,
      cache: createGitRepositoryCache({ cacheRoot: paths.repositoryCacheDir, runner })
    });
    const store = createSkillLibraryStore(paths, undefined, { repositorySource });
    const input = {
      repository: repository.remoteDir,
      ref: "main",
      directory: "skills/review",
      id: "repository-review"
    };

    await expect(store.scanRepositorySkills({ repository: repository.remoteDir })).resolves.toMatchObject({
      transport: "system-git",
      candidates: [expect.objectContaining({ id: "repository-review" })]
    });
    const preview = await store.previewImport({ kind: "repository", input });
    expect(preview).toMatchObject({
      incoming: { id: "repository-review", sourceType: "git" },
      conflicts: []
    });
    const imported = await store.importRepositorySkill({
      ...input,
      expectedContentHash: preview.incoming.contentHash
    });
    expect(imported).toMatchObject({
      id: "repository-review",
      sourceType: "git",
      source: repository.remoteDir,
      remoteRef: "main",
      updatePolicy: "tracked",
      upstream: {
        kind: "git",
        locator: repository.remoteDir,
        ref: "main",
        subpath: "skills/review"
      }
    });

    const targetCopy = join(root, "target", "skills", "repository-review");
    await cp(imported.path, targetCopy, { recursive: true });
    await repository.write("README.md", "Unrelated notes changed\n");
    await repository.commit("unrelated repository update");
    await expect(store.checkUpdates([imported.id])).resolves.toEqual([
      expect.objectContaining({ id: imported.id, updateAvailable: false })
    ]);

    await repository.write("skills/review/prompt.md", "Review the new behavior.\n");
    await repository.commit("update repository skill");
    await expect(store.checkUpdates([imported.id])).resolves.toEqual([
      expect.objectContaining({ id: imported.id, sourceType: "git", updateAvailable: true })
    ]);
    const updatePlan = await store.previewUpdate(imported.id);
    expect(updatePlan).toMatchObject({
      sourceType: "git",
      updateAvailable: true,
      changes: [expect.objectContaining({ path: "prompt.md" })],
      errors: []
    });
    await repository.write("skills/review/prompt.md", "Unreviewed repository change.\n");
    await repository.commit("change repository after preview");
    const updated = await store.updateSkill({ id: imported.id, previewId: updatePlan.previewId! });

    await expect(readFile(join(updated.path, "prompt.md"), "utf8")).resolves.toBe(
      "Review the new behavior.\n"
    );
    await expect(store.checkUpdates([imported.id])).resolves.toEqual([
      expect.objectContaining({ id: imported.id, updateAvailable: true })
    ]);
    await expect(readFile(join(targetCopy, "prompt.md"), "utf8")).resolves.toBe(
      "Review carefully.\n"
    );
    await expect(store.listCleanupBackups()).resolves.toEqual([
      expect.objectContaining({ libraryId: imported.id, operation: "update" })
    ]);
    await rm(repository.remoteDir, { recursive: true, force: true });
    await expect(store.checkUpdates([imported.id])).resolves.toEqual([
      expect.objectContaining({
        id: imported.id,
        updateAvailable: false,
        error: expect.stringContaining("Git command failed")
      })
    ]);
    await expect(readFile(join(updated.path, "prompt.md"), "utf8")).resolves.toBe(
      "Review the new behavior.\n"
    );
  });

  it("persists a custom skill icon across source updates", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: Reviewer\n---\n\n# v1\n", "utf8");
    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer", sourceType: "local" });

    await store.setIcon({ id: "reviewer", iconKey: "shield" });
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: sourceDir });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: Reviewer\n---\n\n# v2\n", "utf8");
    const updatePlan = await store.previewUpdate("reviewer");
    const updated = await store.updateSkill({ id: "reviewer", previewId: updatePlan.previewId! });

    expect(updated.iconKey).toBe("shield");
    await expect(store.listSkills()).resolves.toEqual([
      expect.objectContaining({ id: "reviewer", iconKey: "shield" })
    ]);
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer", ".agentenv-skill.json"), "utf8")
    ).resolves.toContain('"iconKey": "shield"');
  });

  it("removes managed installs with a library skill and restores both from history", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "SKILL.md"),
      "---\nname: reviewer\ndescription: Source skill.\n---\n\n# Reviewer\n",
      "utf8"
    );

    const store = createSkillLibraryStore(paths);
    await store.importSkill({
      sourcePath: sourceDir,
      id: "shared-reviewer",
      sourceType: "local"
    });
    const managedInstall = join(root, "home", ".config", "opencode", "skills", "shared-reviewer");
    await mkdir(managedInstall, { recursive: true });
    await writeFile(join(managedInstall, "SKILL.md"), "# Managed install\n", "utf8");

    const result = await store.removeSkill("shared-reviewer", [managedInstall]);

    await expect(store.listSkills()).resolves.toEqual([]);
    await expect(readFile(join(sourceDir, "SKILL.md"), "utf8")).resolves.toContain("# Reviewer");
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", "SKILL.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(managedInstall, "SKILL.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    await store.rollbackSkillCleanup(result.backupId);
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("# Reviewer");
    await expect(readFile(join(managedInstall, "SKILL.md"), "utf8")).resolves.toBe(
      "# Managed install\n"
    );
  });

  it("finds managed installs without traversing unrelated cyclic skill content", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const skillsDir = join(root, "home", ".agents", "skills");
    const managedInstall = join(skillsDir, "api-test");
    const cyclicSkill = join(skillsDir, "web-testing");
    await mkdir(managedInstall, { recursive: true });
    await writeFile(join(managedInstall, "SKILL.md"), "# API test\n", "utf8");
    await writeFile(
      join(managedInstall, ".agentenv-owner.json"),
      `${JSON.stringify({
        owner: "agentenv-manager",
        targetId: "codex",
        kind: "skill",
        source: "skills-library/api-test"
      })}\n`,
      "utf8"
    );
    await mkdir(cyclicSkill, { recursive: true });
    await writeFile(join(cyclicSkill, "SKILL.md"), "# Web testing\n", "utf8");
    await symlink(cyclicSkill, join(cyclicSkill, "web-testing"), "dir");

    const store = createSkillLibraryStore(paths);
    await expect(
      store.findManagedInstallPaths("api-test", [
        {
          targetId: "opencode",
          configDir: join(root, "home", ".config", "opencode"),
          instructionsPath: "",
          configPath: "",
          skillsDir
        }
      ])
    ).resolves.toEqual([managedInstall]);
  });

  it("uses the configured GitHub access token when importing a GitHub skill", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://api.github.com/repos/acme/skills/contents/reviewer")) {
        return new Response(
          JSON.stringify([
            {
              type: "file",
              name: "SKILL.md",
              path: "reviewer/SKILL.md",
              sha: "skill-sha",
              download_url: "https://raw.githubusercontent.com/acme/skills/main/reviewer/SKILL.md"
            }
          ]),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
      if (url === "https://raw.githubusercontent.com/acme/skills/main/reviewer/SKILL.md") {
        return new Response("---\nname: reviewer\ndescription: GitHub skill.\n---\n", {
          status: 200
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const store = createSkillLibraryStore(paths, undefined, {
      authTokenProvider: async () => "token-xyz",
      fetch: fetchMock
    });

    await store.importGitHubSkill({
      url: "https://github.com/acme/skills/tree/main/reviewer"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("https://api.github.com/repos/acme/skills/contents/reviewer"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-xyz"
        })
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/acme/skills/main/reviewer/SKILL.md",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-xyz"
        })
      })
    );
  });

  it("identifies unauthenticated GitHub rate limit responses", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const store = createSkillLibraryStore(paths, undefined, {
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ message: "API rate limit exceeded" }), {
          status: 403,
          statusText: "Forbidden",
          headers: {
            "content-type": "application/json",
            "x-ratelimit-remaining": "0"
          }
        })
      )
    });

    await expect(
      store.importGitHubSkill({
        url: "https://github.com/acme/skills/tree/main/reviewer"
      })
    ).rejects.toThrow("GitHub API rate limit reached (403 Forbidden)");
  });

  it("scans target skill directories for unmanaged skills", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const managedDir = join(paths.skillsLibraryDir, "managed");
    const unmanagedDir = join(root, "home", ".config", "opencode", "skills", "unmanaged");
    await mkdir(managedDir, { recursive: true });
    await writeFile(join(managedDir, "SKILL.md"), "# Managed\n", "utf8");
    await mkdir(unmanagedDir, { recursive: true });
    await writeFile(
      join(unmanagedDir, "SKILL.md"),
      "---\nname: unmanaged\ndescription: Import me.\n---\n",
      "utf8"
    );

    const store = createSkillLibraryStore(paths);
    const unmanaged = await store.scanUnmanaged([
      {
        targetId: "opencode",
        configDir: join(root, "home", ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: join(root, "home", ".config", "opencode", "skills")
      }
    ]);

    expect(unmanaged).toEqual([
      {
        id: "unmanaged",
        name: "unmanaged",
        description: "Import me.",
        path: unmanagedDir,
        foundIn: ["opencode"]
      }
    ]);
  });

  it("scans target skill directories into a full managed and unmanaged inventory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const managedLibraryDir = join(paths.skillsLibraryDir, "shared-reviewer");
    const managedTargetDir = join(root, "home", ".config", "opencode", "skills", "reviewer");
    const unmanagedDir = join(root, "home", ".config", "opencode", "skills", "legacy");
    await mkdir(managedLibraryDir, { recursive: true });
    await writeFile(
      join(managedLibraryDir, "SKILL.md"),
      "---\nname: Shared Reviewer\ndescription: Managed from library.\n---\n",
      "utf8"
    );
    await mkdir(managedTargetDir, { recursive: true });
    await symlink(join(managedLibraryDir, "SKILL.md"), join(managedTargetDir, "SKILL.md"));
    await writeFile(
      join(managedTargetDir, ".agentenv-owner.json"),
      JSON.stringify(
        {
          owner: "agentenv-manager",
          profileId: "daily",
          targetId: "opencode",
          kind: "skill",
          source: "skills-library/shared-reviewer"
        },
        null,
        2
      ),
      "utf8"
    );
    await mkdir(unmanagedDir, { recursive: true });
    await writeFile(
      join(unmanagedDir, "SKILL.md"),
      "---\nname: Legacy\ndescription: Import me.\n---\n",
      "utf8"
    );

    const store = createSkillLibraryStore(paths);
    const inventory = await store.scanInventory([
      {
        targetId: "opencode",
        configDir: join(root, "home", ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: join(root, "home", ".config", "opencode", "skills")
      }
    ]);

    expect(inventory).toMatchObject([
      {
        id: "legacy",
        name: "Legacy",
        description: "Import me.",
        path: unmanagedDir,
        foundIn: ["opencode"],
        status: "unmanaged",
        libraryId: undefined,
        skillKey: "legacy"
      },
      {
        id: "reviewer",
        name: "Shared Reviewer",
        description: "Managed from library.",
        path: managedTargetDir,
        foundIn: ["opencode"],
        status: "managed",
        libraryId: "shared-reviewer",
        skillKey: "shared-reviewer",
        installMethod: "linked",
        contentMatchesLibrary: true
      }
    ]);
    expect(inventory.every((skill) => skill.contentHash.length === 64)).toBe(true);
  });

  it("marks ignored local skill groups without hiding them from inventory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const codexCopy = join(root, "home", ".agents", "skills", "duplicate-reviewer");
    const opencodeCopy = join(root, "home", ".config", "opencode", "skills", "duplicate-reviewer");
    await mkdir(codexCopy, { recursive: true });
    await mkdir(opencodeCopy, { recursive: true });
    await writeFile(
      join(codexCopy, "SKILL.md"),
      "---\nname: Duplicate Reviewer\ndescription: Same skill.\n---\n",
      "utf8"
    );
    await writeFile(
      join(opencodeCopy, "SKILL.md"),
      "---\nname: Duplicate Reviewer\ndescription: Same skill.\n---\n",
      "utf8"
    );

    const store = createSkillLibraryStore(paths);
    const firstScan = await store.scanInventory([
      {
        targetId: "codex",
        configDir: join(root, "home", ".codex"),
        instructionsPath: "",
        configPath: "",
        skillsDir: join(root, "home", ".agents", "skills")
      },
      {
        targetId: "opencode",
        configDir: join(root, "home", ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: join(root, "home", ".config", "opencode", "skills")
      }
    ]);

    expect(firstScan.map((skill) => skill.skillKey)).toEqual([
      "duplicate-reviewer",
      "duplicate-reviewer"
    ]);
    expect(new Set(firstScan.map((skill) => skill.contentHash)).size).toBe(1);

    await store.ignoreSkillGroup("duplicate-reviewer");
    const ignoredScan = await store.scanInventory([
      {
        targetId: "codex",
        configDir: join(root, "home", ".codex"),
        instructionsPath: "",
        configPath: "",
        skillsDir: join(root, "home", ".agents", "skills")
      },
      {
        targetId: "opencode",
        configDir: join(root, "home", ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: join(root, "home", ".config", "opencode", "skills")
      }
    ]);

    expect(ignoredScan).toHaveLength(2);
    expect(ignoredScan.map((skill) => skill.status)).toEqual(["ignored", "ignored"]);
    expect(ignoredScan.every((skill) => skill.ignoreRuleId)).toBe(true);

    await store.unignoreSkillGroup("duplicate-reviewer");
    await expect(
      store.scanInventory([
        {
          targetId: "codex",
          configDir: join(root, "home", ".codex"),
          instructionsPath: "",
          configPath: "",
          skillsDir: join(root, "home", ".agents", "skills")
        }
      ])
    ).resolves.toMatchObject([{ status: "unmanaged" }]);
  });

  it("restores a legacy directory-key ignore rule through the runtime Skill name", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const homeDir = join(root, "home");
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir });
    const skillDir = join(homeDir, ".config", "opencode", "skills", "legacy-folder");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: runtime-reviewer\ndescription: Legacy ignore key.\n---\n"
    );
    await mkdir(paths.appDataRoot, { recursive: true });
    await writeFile(
      join(paths.appDataRoot, "skill-cleanup-ignore-rules.json"),
      JSON.stringify([{ id: "ignore-legacy-folder", scope: "group", skillKey: "legacy-folder" }])
    );
    const store = createSkillLibraryStore(paths);
    const targetPaths = createOpenCodeTargetAdapter().createTargetPaths({ homeDir });

    await expect(store.scanInventory([targetPaths])).resolves.toEqual([
      expect.objectContaining({ skillKey: "runtime-reviewer", status: "ignored" })
    ]);
    await store.unignoreSkillGroup("runtime-reviewer");
    await expect(store.scanInventory([targetPaths])).resolves.toEqual([
      expect.objectContaining({ skillKey: "runtime-reviewer", status: "unmanaged" })
    ]);
  });

  it("identifies and retains only shared compatibility Skill locations", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sharedRoot = paths.userSkillsDir;
    const sharedCopy = join(sharedRoot, "reviewer");
    const targetRoot = join(paths.homeDir, ".config", "opencode", "skills");
    const targetCopy = join(targetRoot, "reviewer");
    await mkdir(sharedCopy, { recursive: true });
    await mkdir(targetCopy, { recursive: true });
    await writeFile(join(sharedCopy, "SKILL.md"), "# Shared\n", "utf8");
    await writeFile(join(targetCopy, "SKILL.md"), "# Target\n", "utf8");
    const store = createSkillLibraryStore(paths);
    const targetPaths = {
      targetId: "opencode",
      configDir: join(paths.homeDir, ".config", "opencode"),
      instructionsPath: "",
      configPath: "",
      skillsDir: targetRoot,
      skillScanDirs: [targetRoot, sharedRoot],
      skillLocations: [
        { path: targetRoot, role: "preferred-runtime" as const, shared: false },
        { path: sharedRoot, role: "compatibility-runtime" as const, shared: true }
      ]
    };

    const firstScan = await store.scanInventory([targetPaths]);
    expect(firstScan.find((item) => item.path === sharedCopy)).toMatchObject({
      locationRole: "compatibility-runtime",
      sharedLocation: true,
      status: "unmanaged"
    });
    expect(firstScan.find((item) => item.path === targetCopy)).toMatchObject({
      locationRole: "preferred-runtime",
      sharedLocation: false,
      status: "unmanaged"
    });

    await store.setSharedSkillRetention({
      skillKey: "reviewer",
      paths: [sharedCopy],
      retained: true
    });
    const retainedScan = await store.scanInventory([targetPaths]);
    expect(retainedScan.find((item) => item.path === sharedCopy)).toMatchObject({
      status: "ignored",
      ignoreReason: "keep-shared"
    });
    expect(retainedScan.find((item) => item.path === targetCopy)?.status).toBe("unmanaged");

    await store.setSharedSkillRetention({
      skillKey: "reviewer",
      paths: [sharedCopy],
      retained: false
    });
    await expect(store.scanInventory([targetPaths])).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: sharedCopy, status: "unmanaged" })])
    );
  });

  it("cleans every Target copy when one adapter also scans another Target's Skill directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const openCodePaths = createOpenCodeTargetAdapter().createTargetPaths({ homeDir: paths.homeDir });
    const claudePaths = createClaudeCodeTargetAdapter().createTargetPaths({ homeDir: paths.homeDir });
    const sharedCopy = join(paths.homeDir, ".agents", "skills", "demo");
    const openCodeCopy = join(paths.homeDir, ".config", "opencode", "skills", "demo");
    const claudeCopy = join(paths.homeDir, ".claude", "skills", "demo");
    for (const path of [sharedCopy, openCodeCopy, claudeCopy]) {
      await mkdir(path, { recursive: true });
    }
    await writeFile(join(sharedCopy, "SKILL.md"), "# Shared demo\n", "utf8");
    await writeFile(join(openCodeCopy, "SKILL.md"), "# OpenCode demo\n", "utf8");
    await writeFile(join(claudeCopy, "SKILL.md"), "# Claude demo\n", "utf8");
    const store = createSkillLibraryStore(paths);

    const firstScan = await store.scanInventory([openCodePaths, claudePaths]);
    const group = buildSkillCleanupGroups(firstScan).find((item) => item.skillKey === "demo");

    expect(group?.items).toHaveLength(3);
    expect(group?.items.find((item) => item.path === sharedCopy)).toMatchObject({
      sharedLocation: true
    });
    expect(group?.items.find((item) => item.path === openCodeCopy)).toMatchObject({
      foundIn: ["opencode"],
      locationRole: "preferred-runtime",
      sharedLocation: false
    });
    expect(group?.items.find((item) => item.path === claudeCopy)).toMatchObject({
      foundIn: ["claude-code", "opencode"],
      locationRole: "preferred-runtime",
      sharedLocation: false
    });

    const sharedPaths = group?.items.filter((item) => item.sharedLocation).map((item) => item.path) ?? [];
    const duplicatePaths = group?.items.filter((item) => !item.sharedLocation).map((item) => item.path) ?? [];
    await store.consolidateSharedSkillGroup({
      skillKey: "demo",
      libraryId: "demo",
      canonicalPath: claudeCopy,
      sharedPaths,
      duplicatePaths
    });

    const secondScan = await store.scanInventory([openCodePaths, claudePaths]);
    expect(secondScan).toHaveLength(1);
    expect(secondScan[0]).toMatchObject({
      path: sharedCopy,
      sharedLocation: true,
      libraryId: "demo",
      contentMatchesLibrary: true
    });
  });

  it("scans additional target skill roots such as singular OpenCode skill directories", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const pluralDir = join(root, "home", ".config", "opencode", "skills", "plural-reviewer");
    const singularDir = join(root, "home", ".config", "opencode", "skill", "singular-reviewer");
    const externalDir = join(root, "home", ".agents", "skills", "external-reviewer");
    await mkdir(pluralDir, { recursive: true });
    await mkdir(singularDir, { recursive: true });
    await mkdir(externalDir, { recursive: true });
    await writeFile(
      join(pluralDir, "SKILL.md"),
      "---\nname: Plural Reviewer\ndescription: Plural root.\n---\n",
      "utf8"
    );
    await writeFile(
      join(singularDir, "SKILL.md"),
      "---\nname: Singular Reviewer\ndescription: Singular root.\n---\n",
      "utf8"
    );
    await writeFile(
      join(externalDir, "SKILL.md"),
      "---\nname: External Reviewer\ndescription: External shared root.\n---\n",
      "utf8"
    );

    const store = createSkillLibraryStore(paths);
    const inventory = await store.scanInventory([
      {
        targetId: "opencode",
        configDir: join(root, "home", ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: join(root, "home", ".config", "opencode", "skills"),
        skillScanDirs: [
          join(root, "home", ".config", "opencode", "skill"),
          join(root, "home", ".agents", "skills")
        ]
      }
    ]);

    expect(inventory.map((skill) => skill.id)).toEqual([
      "external-reviewer",
      "plural-reviewer",
      "singular-reviewer"
    ]);
  });

  it("replaces an imported target skill with an AgentEnv-managed library skill", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const libraryDir = join(paths.skillsLibraryDir, "legacy");
    const targetSkillsDir = join(root, "home", ".config", "opencode", "skills");
    const targetDir = join(targetSkillsDir, "legacy");
    await mkdir(libraryDir, { recursive: true });
    await writeFile(
      join(libraryDir, "SKILL.md"),
      "---\nname: Legacy\ndescription: Library copy.\n---\n\n# From Library\n",
      "utf8"
    );
    await mkdir(targetDir, { recursive: true });
    await writeFile(
      join(targetDir, "SKILL.md"),
      "---\nname: Legacy\ndescription: Old target copy.\n---\n\n# From Target\n",
      "utf8"
    );

    const store = createSkillLibraryStore(paths);
    await store.manageTargetSkill({
      targetPaths: {
        targetId: "opencode",
        configDir: join(root, "home", ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: targetSkillsDir
      },
      targetName: "legacy",
      libraryId: "legacy"
    });

    await expect(readFile(join(targetDir, "SKILL.md"), "utf8")).resolves.toContain(
      "# From Library"
    );
    expect((await lstat(targetDir)).isSymbolicLink()).toBe(true);
    await expect(readlink(targetDir)).resolves.toBe(join(paths.skillsLibraryDir, "legacy"));
    await expect(readFile(`${targetDir}.agentenv-owner.json`, "utf8")).resolves.toContain(
      '"source": "skills-library/legacy"'
    );

    const inventory = await store.scanInventory([
      {
        targetId: "opencode",
        configDir: join(root, "home", ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: targetSkillsDir
      }
    ]);
    expect(inventory).toMatchObject([
      {
        id: "legacy",
        status: "managed",
        libraryId: "legacy"
      }
    ]);
  });

  it("recognizes an AgentEnv-owned install from every Target that scans the same path", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-target-owner-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const libraryDir = join(paths.skillsLibraryDir, "shared-reviewer");
    const targetDir = join(paths.userSkillsDir, "shared-reviewer");
    await mkdir(libraryDir, { recursive: true });
    await mkdir(targetDir, { recursive: true });
    const content = "---\nname: Shared Reviewer\n---\n\n# Shared\n";
    await writeFile(join(libraryDir, "SKILL.md"), content, "utf8");
    await writeFile(join(targetDir, "SKILL.md"), content, "utf8");
    await writeFile(
      join(targetDir, ".agentenv-owner.json"),
      JSON.stringify({
        owner: "agentenv-manager",
        profileId: "codex-profile",
        targetId: "codex",
        kind: "skill",
        source: "skills-library/shared-reviewer"
      }),
      "utf8"
    );

    const store = createSkillLibraryStore(paths);
    const codexInventory = await store.scanInventory([
      {
        targetId: "codex",
        configDir: join(paths.homeDir, ".codex"),
        instructionsPath: "",
        configPath: "",
        skillsDir: paths.userSkillsDir
      }
    ]);
    const openCodeInventory = await store.scanInventory([
      {
        targetId: "opencode",
        configDir: join(paths.homeDir, ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: paths.userSkillsDir
      }
    ]);
    const sharedInventory = await store.scanInventory([
      {
        targetId: "codex",
        configDir: join(paths.homeDir, ".codex"),
        instructionsPath: "",
        configPath: "",
        skillsDir: paths.userSkillsDir
      },
      {
        targetId: "opencode",
        configDir: join(paths.homeDir, ".config", "opencode"),
        instructionsPath: "",
        configPath: "",
        skillsDir: paths.userSkillsDir
      }
    ]);

    expect(codexInventory[0]).toMatchObject({
      status: "managed",
      libraryId: "shared-reviewer",
      managedByTarget: true
    });
    expect(openCodeInventory[0]).toMatchObject({
      status: "managed",
      libraryId: "shared-reviewer",
      managedByTarget: false
    });
    expect(sharedInventory).toHaveLength(1);
    expect(sharedInventory[0]).toMatchObject({
      status: "managed",
      libraryId: "shared-reviewer",
      foundIn: ["codex", "opencode"]
    });
  });

  it("backs up, consolidates, and rolls back a duplicate skill group transactionally", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const openCodeSkills = join(root, "home", ".config", "opencode", "skills");
    const codexSkills = join(root, "home", ".agents", "skills");
    const openCodeCopy = join(openCodeSkills, "reviewer");
    const codexCopy = join(codexSkills, "reviewer");
    await mkdir(openCodeCopy, { recursive: true });
    await mkdir(codexCopy, { recursive: true });
    await writeFile(join(openCodeCopy, "SKILL.md"), "# Canonical\n", "utf8");
    await writeFile(join(codexCopy, "SKILL.md"), "# Older copy\n", "utf8");
    const store = createSkillLibraryStore(paths);

    const result = await store.consolidateSkillGroup({
      skillKey: "reviewer",
      libraryId: "reviewer",
      canonicalPath: openCodeCopy,
      locations: [
        {
          targetPaths: {
            targetId: "opencode",
            configDir: dirname(openCodeSkills),
            instructionsPath: "",
            configPath: "",
            skillsDir: openCodeSkills
          },
          targetDir: openCodeCopy
        },
        {
          targetPaths: {
            targetId: "codex",
            configDir: join(root, "home", ".codex"),
            instructionsPath: "",
            configPath: "",
            skillsDir: codexSkills
          },
          targetDir: codexCopy
        }
      ]
    });

    await expect(store.listCleanupBackups()).resolves.toEqual([
      {
        id: result.backupId,
        libraryId: "reviewer",
        createdAt: expect.any(String),
        locationCount: 2,
        operation: "cleanup"
      }
    ]);

    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")).resolves.toBe("# Canonical\n");
    await expect(readFile(join(openCodeCopy, "SKILL.md"), "utf8")).resolves.toBe("# Canonical\n");
    await expect(readFile(join(codexCopy, "SKILL.md"), "utf8")).resolves.toBe("# Canonical\n");
    expect(result.managedLocations).toEqual([openCodeCopy, codexCopy]);

    await store.rollbackSkillCleanup(result.backupId);
    await expect(store.listCleanupBackups()).resolves.toEqual([]);

    await expect(readFile(join(openCodeCopy, "SKILL.md"), "utf8")).resolves.toBe("# Canonical\n");
    await expect(readFile(join(codexCopy, "SKILL.md"), "utf8")).resolves.toBe("# Older copy\n");
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("trusts cleanup roots supplied by a newly registered target", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({
      appDataRoot: join(root, "app-data"),
      homeDir: join(root, "home")
    });
    const fixtureSkillsDir = join(paths.homeDir, ".fixture-agent", "extensions");
    const fixtureCopy = join(fixtureSkillsDir, "reviewer");
    await mkdir(fixtureCopy, { recursive: true });
    await writeFile(join(fixtureCopy, "SKILL.md"), "# Fixture copy\n", "utf8");
    const targetPaths = {
      targetId: "fixture-agent",
      configDir: dirname(fixtureSkillsDir),
      instructionsPath: join(paths.homeDir, ".fixture-agent", "AGENT.md"),
      configPath: join(paths.homeDir, ".fixture-agent", "fixture.json"),
      skillsDir: fixtureSkillsDir
    };
    const store = createSkillLibraryStore(paths, undefined, {
      targetPathsProvider: () => [targetPaths]
    });

    const result = await store.consolidateSkillGroup({
      skillKey: "reviewer",
      libraryId: "reviewer",
      canonicalPath: fixtureCopy,
      locations: [{ targetPaths, targetDir: fixtureCopy }]
    });

    await store.rollbackSkillCleanup(result.backupId);
    await expect(readFile(join(fixtureCopy, "SKILL.md"), "utf8")).resolves.toBe(
      "# Fixture copy\n"
    );
  });

  it("adds a chosen shared version to Library without assigning Target ownership", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sharedCopy = join(paths.homeDir, ".agents", "skills", "reviewer");
    const openCodeCopy = join(paths.homeDir, ".config", "opencode", "skills", "reviewer");
    const codexCopy = join(paths.homeDir, ".codex", "skills", "reviewer");
    for (const path of [sharedCopy, openCodeCopy, codexCopy]) {
      await mkdir(path, { recursive: true });
    }
    await writeFile(join(sharedCopy, "SKILL.md"), "# Shared current\n", "utf8");
    await writeFile(join(openCodeCopy, "SKILL.md"), "# OpenCode older\n", "utf8");
    await writeFile(join(codexCopy, "SKILL.md"), "# Chosen version\n", "utf8");
    const store = createSkillLibraryStore(paths);

    const result = await store.consolidateSharedSkillGroup({
      skillKey: "reviewer",
      libraryId: "reviewer",
      canonicalPath: codexCopy,
      sharedPaths: [sharedCopy],
      duplicatePaths: [openCodeCopy, codexCopy]
    });

    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toBe("# Chosen version\n");
    await expect(readFile(join(sharedCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Chosen version\n");
    await expect(readFile(join(sharedCopy, ".agentenv-owner.json"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(openCodeCopy, "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(codexCopy, "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(result.managedLocations).toEqual([sharedCopy]);

    await store.rollbackSkillCleanup(result.backupId);
    await expect(readFile(join(sharedCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Shared current\n");
    await expect(readFile(join(openCodeCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# OpenCode older\n");
    await expect(readFile(join(codexCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Chosen version\n");
  });

  it("keeps an existing Library version while normalizing shared copies", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const librarySource = join(root, "source", "reviewer");
    const sharedCopy = join(paths.homeDir, ".agents", "skills", "reviewer");
    const duplicateCopy = join(paths.homeDir, ".config", "opencode", "skills", "reviewer");
    for (const path of [librarySource, sharedCopy, duplicateCopy]) {
      await mkdir(path, { recursive: true });
    }
    await writeFile(join(librarySource, "SKILL.md"), "# Library canonical\n", "utf8");
    await writeFile(join(sharedCopy, "SKILL.md"), "# Shared drift\n", "utf8");
    await writeFile(join(duplicateCopy, "SKILL.md"), "# Target drift\n", "utf8");
    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: librarySource, id: "reviewer", sourceType: "local" });

    const result = await store.consolidateSharedSkillGroup({
      skillKey: "reviewer",
      libraryId: "reviewer",
      canonicalPath: sharedCopy,
      sharedPaths: [sharedCopy],
      duplicatePaths: [duplicateCopy]
    });

    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toBe("# Library canonical\n");
    await expect(readFile(join(sharedCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Library canonical\n");
    await expect(readFile(join(duplicateCopy, "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    await store.rollbackSkillCleanup(result.backupId);
    await expect(readFile(join(sharedCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Shared drift\n");
    await expect(readFile(join(duplicateCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Target drift\n");
  });

  it("uses an existing Library version without requiring a selected canonical location", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const librarySource = join(root, "source", "reviewer");
    const targetSkillsDir = join(root, "home", ".config", "opencode", "skills");
    const targetCopy = join(targetSkillsDir, "reviewer");
    await mkdir(librarySource, { recursive: true });
    await mkdir(targetCopy, { recursive: true });
    await writeFile(join(librarySource, "SKILL.md"), "# Library source\n", "utf8");
    await writeFile(join(targetCopy, "SKILL.md"), "# Local drift\n", "utf8");
    const store = createSkillLibraryStore(paths);
    await store.importSkill({
      sourcePath: librarySource,
      id: "reviewer",
      sourceType: "local"
    });

    await store.consolidateSkillGroup({
      skillKey: "reviewer",
      libraryId: "reviewer",
      canonicalPath: join(root, "not-selected", "reviewer"),
      locations: [
        {
          targetPaths: {
            targetId: "opencode",
            configDir: dirname(targetSkillsDir),
            instructionsPath: "",
            configPath: "",
            skillsDir: targetSkillsDir
          },
          targetDir: targetCopy
        }
      ]
    });

    await expect(readFile(join(targetCopy, "SKILL.md"), "utf8")).resolves.toBe(
      "# Library source\n"
    );
    expect((await lstat(targetCopy)).isSymbolicLink()).toBe(true);
    await expect(readlink(targetCopy)).resolves.toBe(join(paths.skillsLibraryDir, "reviewer"));
    await expect(readFile(`${targetCopy}.agentenv-owner.json`, "utf8")).resolves.toContain(
      '"source": "skills-library/reviewer"'
    );
  });

  it("attempts every restore when a later cleanup location cannot be replaced", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const targetRoots = ["one", "two", "three"].map((name) => join(root, name, "skills"));
    const targetCopies = targetRoots.map((skillsDir) => join(skillsDir, "reviewer"));
    for (const [index, targetCopy] of targetCopies.entries()) {
      await mkdir(targetCopy, { recursive: true });
      await writeFile(join(targetCopy, "SKILL.md"), `# Original ${index + 1}\n`);
    }
    const store = createSkillLibraryStore(paths);
    await chmod(targetRoots[2], 0o555);
    try {
      await expect(
        store.consolidateSkillGroup({
          skillKey: "reviewer",
          libraryId: "reviewer",
          canonicalPath: targetCopies[0],
          locations: targetCopies.map((targetDir, index) => ({
            targetPaths: {
              targetId: `target-${index + 1}`,
              configDir: dirname(targetRoots[index]),
              instructionsPath: "",
              configPath: "",
              skillsDir: targetRoots[index]
            },
            targetDir
          }))
        })
      ).rejects.toThrow(/failed.*rollback/i);
    } finally {
      await chmod(targetRoots[2], 0o755);
    }

    await expect(readFile(join(targetCopies[0], "SKILL.md"), "utf8")).resolves.toBe("# Original 1\n");
    await expect(readFile(join(targetCopies[1], "SKILL.md"), "utf8")).resolves.toBe("# Original 2\n");
    await expect(readFile(join(targetCopies[2], "SKILL.md"), "utf8")).resolves.toBe("# Original 3\n");
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("backs up an existing Library version before replacing it with reviewed local content", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const librarySource = join(root, "source", "reviewer");
    const targetSkillsDir = join(root, "home", ".config", "opencode", "skills");
    const targetCopy = join(targetSkillsDir, "reviewer");
    await mkdir(librarySource, { recursive: true });
    await mkdir(targetCopy, { recursive: true });
    await writeFile(join(librarySource, "SKILL.md"), "# Library source\n", "utf8");
    await writeFile(join(targetCopy, "SKILL.md"), "# Reviewed local version\n", "utf8");
    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: librarySource, id: "reviewer", sourceType: "local" });

    const result = await store.consolidateSkillGroup({
      skillKey: "reviewer",
      libraryId: "reviewer",
      canonicalPath: targetCopy,
      replaceLibrary: true,
      locations: [
        {
          targetPaths: {
            targetId: "opencode",
            configDir: dirname(targetSkillsDir),
            instructionsPath: "",
            configPath: "",
            skillsDir: targetSkillsDir
          },
          targetDir: targetCopy
        }
      ]
    });

    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toBe("# Reviewed local version\n");
    await expect(readFile(join(targetCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Reviewed local version\n");

    await store.rollbackSkillCleanup(result.backupId);
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8"))
      .resolves.toBe("# Library source\n");
    await expect(readFile(join(targetCopy, "SKILL.md"), "utf8"))
      .resolves.toBe("# Reviewed local version\n");
  });

  it("saves an update source for an existing library skill", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const originalDir = join(root, "original", "reviewer");
    const updateDir = join(root, "updates", "reviewer");
    await mkdir(originalDir, { recursive: true });
    await mkdir(updateDir, { recursive: true });
    await writeFile(join(originalDir, "SKILL.md"), "---\nname: reviewer\n---\n# v1\n", "utf8");
    await writeFile(join(updateDir, "SKILL.md"), "---\nname: reviewer\n---\n# v2\n", "utf8");

    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: originalDir, id: "reviewer", sourceType: "local" });

    const updated = await store.setUpdateSource({
      id: "reviewer",
      sourceType: "local",
      source: updateDir
    });

    expect(updated.sourceType).toBe("local");
    expect(updated.source).toBe(updateDir);
    expect(updated.updatePolicy).toBe("tracked");
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer", ".agentenv-skill.json"), "utf8")
    ).resolves.toContain(updateDir);
  });

  it("persists global availability and excludes disabled skills from update checks", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    const updateDir = join(root, "updates", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(updateDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v1\n", "utf8");
    await writeFile(join(updateDir, "SKILL.md"), "---\nname: reviewer\n---\n# v2\n", "utf8");
    const store = createSkillLibraryStore(paths);
    const imported = await store.importSkill({ sourcePath: sourceDir, id: "reviewer" });
    expect(imported.globallyEnabled).toBe(true);
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: updateDir });

    const disabled = await store.setAvailability({ id: "reviewer", enabled: false });

    expect(disabled.globallyEnabled).toBe(false);
    await expect(store.checkUpdates()).resolves.toEqual([]);
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer", ".agentenv-skill.json"), "utf8")
    ).resolves.toContain('"globallyEnabled": false');
    await expect(store.listSkills()).resolves.toEqual([
      expect.objectContaining({ id: "reviewer", globallyEnabled: false })
    ]);

    const enabled = await store.setAvailability({ id: "reviewer", enabled: true });
    expect(enabled.globallyEnabled).toBe(true);
    await expect(store.checkUpdates()).resolves.toEqual([
      expect.objectContaining({ id: "reviewer", updateAvailable: true })
    ]);
  });

  it("detects updates after a GitHub source is configured on an existing library skill", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# local\n", "utf8");
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/agent-skills/contents/skills/reviewer?ref=main")) {
        return new Response(
          JSON.stringify([
            {
              type: "file",
              name: "SKILL.md",
              path: "skills/reviewer/SKILL.md",
              download_url: "https://raw.example/SKILL.md",
              sha: "skill-md-sha"
            }
          ])
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const store = createSkillLibraryStore(paths, undefined, { fetch: fetchImpl });
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer", sourceType: "local" });
    await store.setUpdateSource({
      id: "reviewer",
      sourceType: "github",
      source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer"
    });
    await store.setUpdatePolicy({ id: "reviewer", policy: "tracked" });

    fetchImpl.mockClear();
    await expect(store.checkUpdates(["another-skill"])).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();

    const updates = await store.checkUpdates();

    expect(updates).toEqual([
      {
        id: "reviewer",
        name: "reviewer",
        sourceType: "github",
        currentRevision: undefined,
        latestRevision: "2ae0ba4cfd9c5eb970776d3bd9ffad6e00682cee",
        updateAvailable: true
      }
    ]);
  });

  it("previews how a local source update will change a library skill", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v1\n", "utf8");
    await writeFile(join(sourceDir, "old.md"), "remove me\n", "utf8");

    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer", sourceType: "local" });
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: sourceDir });
    await store.setUpdatePolicy({ id: "reviewer", policy: "tracked" });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v2\n", "utf8");
    await writeFile(join(sourceDir, "new.md"), "add me\n", "utf8");
    await rm(join(sourceDir, "old.md"));

    const plan = await store.previewUpdate("reviewer");

    expect(plan).toMatchObject({
      id: "reviewer",
      name: "reviewer",
      sourceType: "local",
      source: sourceDir,
      updateAvailable: true,
      errors: []
    });
    expect(plan.changes.map((change) => change.path)).toEqual(["SKILL.md", "new.md", "old.md"]);
    expect(plan.changes[0].diff).toContain("# v2");
  });

  it("applies the exact local Skill candidate that was reviewed", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v1\n", "utf8");

    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer", sourceType: "local" });
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: sourceDir });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# reviewed v2\n", "utf8");

    const plan = await store.previewUpdate("reviewer");
    expect(plan.previewId).toBeTruthy();

    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# unreviewed v3\n", "utf8");
    const updated = await store.updateSkill({ id: "reviewer", previewId: plan.previewId! });

    await expect(readFile(join(updated.path, "SKILL.md"), "utf8")).resolves.toContain(
      "# reviewed v2"
    );
    await expect(readFile(join(updated.path, "SKILL.md"), "utf8")).resolves.not.toContain(
      "# unreviewed v3"
    );
  });

  it("detects and applies binary Skill asset changes without decoding them as text", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# Reviewer\n", "utf8");
    await writeFile(join(sourceDir, "icon.png"), Buffer.from([0, 1, 2, 3]));

    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer", sourceType: "local" });
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: sourceDir });
    await writeFile(join(sourceDir, "icon.png"), Buffer.from([0, 1, 9, 3]));

    const plan = await store.previewUpdate("reviewer");
    expect(plan.changes).toEqual([
      expect.objectContaining({
        path: "icon.png",
        before: expect.stringContaining("[binary file: 4 bytes, sha256"),
        after: expect.stringContaining("[binary file: 4 bytes, sha256")
      })
    ]);

    const updated = await store.updateSkill({ id: "reviewer", previewId: plan.previewId! });
    await expect(readFile(join(updated.path, "icon.png"))).resolves.toEqual(
      Buffer.from([0, 1, 9, 3])
    );
  });

  it("rejects a Skill update when the Library copy changed after preview", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v1\n", "utf8");

    const store = createSkillLibraryStore(paths);
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer", sourceType: "local" });
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: sourceDir });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v2\n", "utf8");
    const plan = await store.previewUpdate("reviewer");

    await writeFile(
      join(paths.skillsLibraryDir, "reviewer", "SKILL.md"),
      "---\nname: reviewer\n---\n# edited after preview\n",
      "utf8"
    );

    await expect(
      store.updateSkill({ id: "reviewer", previewId: plan.previewId! })
    ).rejects.toThrow("changed after the update preview");
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("# edited after preview");
  });

  it("reports Profile, linked install, and copied install impact in update previews", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v1\n", "utf8");
    const profile = {
      id: "daily-coding",
      profileDir: join(paths.profilesDir, "daily-coding"),
      manifest: {
        id: "daily-coding",
        preferredTargetId: "opencode",
        name: "Daily Coding",
        description: "",
        version: 2 as const
      },
      instructions: "",
      resources: {
        skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true }],
        mcpByTarget: {}
      }
    };
    const profileStore = {
      listProfiles: vi.fn().mockResolvedValue([profile.manifest]),
      readProfile: vi.fn().mockResolvedValue(profile),
      saveProfile: vi.fn()
    };
    let syncMethod: "symlink" | "copy" = "symlink";
    const settingsStore = {
      readSettings: vi.fn(async () => ({
        locale: "system" as const,
        skillSyncMethod: syncMethod,
        skillStorageLocation: "appData" as const,
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null
      }))
    };
    const openCodePaths = createOpenCodeTargetAdapter().createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const claudePaths = createClaudeCodeTargetAdapter().createTargetPaths({
      homeDir: paths.homeDir,
      fakeHomeRoot: paths.fakeHomeRoot
    });
    const store = createSkillLibraryStore(paths, settingsStore, {
      profileStore,
      targetPathsProvider: () => [openCodePaths, claudePaths]
    });
    await store.importSkill({ sourcePath: sourceDir, id: "reviewer", sourceType: "local" });
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: sourceDir });
    await store.deployLibrarySkill({
      targetPaths: openCodePaths,
      targetName: "reviewer",
      libraryId: "reviewer",
      profileId: profile.id
    });
    syncMethod = "copy";
    await store.deployLibrarySkill({
      targetPaths: claudePaths,
      targetName: "reviewer",
      libraryId: "reviewer",
      profileId: profile.id
    });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n# v2\n", "utf8");

    const plan = await store.previewUpdate("reviewer");

    expect(plan.impact).toEqual({
      profileNames: ["Daily Coding"],
      linkedInstallCount: 1,
      linkedTargetIds: ["opencode"],
      copiedInstallCount: 1,
      copiedTargetIds: ["claude-code", "opencode"]
    });
  });

  it("refreshes local-source skills and records a new content hash", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const sourceDir = join(root, "source", "reviewer");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n\n# v1\n", "utf8");

    const store = createSkillLibraryStore(paths);
    const first = await store.importSkill({
      sourcePath: sourceDir,
      id: "reviewer",
      sourceType: "local"
    });
    await store.setUpdateSource({ id: "reviewer", sourceType: "local", source: sourceDir });
    await store.setUpdatePolicy({ id: "reviewer", policy: "tracked" });
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n\n# v2\n", "utf8");

    const updatePlan = await store.previewUpdate("reviewer");
    const updated = await store.updateSkill({ id: "reviewer", previewId: updatePlan.previewId! });

    expect(updated.contentHash).not.toBe(first.contentHash);
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")).resolves.toContain(
      "# v2"
    );
  });

  it("discovers and imports every skill in a GitHub directory", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const skillFiles = new Map([
      [
        "skills/engineering/code-review/SKILL.md",
        "---\nname: Code Review\ndescription: Review code carefully.\n---\n"
      ],
      [
        "skills/engineering/research/SKILL.md",
        "---\nname: Research\ndescription: Research primary sources.\n---\n"
      ]
    ]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/commits/main")) {
        return new Response(JSON.stringify({ commit: { tree: { sha: "tree-main" } } }));
      }
      if (url.includes("/commits/")) {
        return new Response("Not found", { status: 404, statusText: "Not Found" });
      }
      if (url.includes("/git/trees/tree-main")) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [...skillFiles.keys()].map((path, index) => ({
              path,
              type: "blob",
              sha: `skill-${index}`
            }))
          })
        );
      }
      if (url.startsWith("https://raw.githubusercontent.com/acme/skills/main/")) {
        const path = url.slice("https://raw.githubusercontent.com/acme/skills/main/".length);
        return new Response(skillFiles.get(path) ?? "Not found", {
          status: skillFiles.has(path) ? 200 : 404
        });
      }
      const contentsMatch = url.match(/\/contents\/(.+)\?ref=main$/);
      if (contentsMatch) {
        const path = `${contentsMatch[1]}/SKILL.md`;
        if (!skillFiles.has(path)) {
          return new Response("Not found", { status: 404, statusText: "Not Found" });
        }
        return new Response(
          JSON.stringify([
            {
              type: "file",
              name: "SKILL.md",
              path,
              sha: `contents-${path}`,
              download_url: `https://raw.githubusercontent.com/acme/skills/main/${path}`
            }
          ])
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const store = createSkillLibraryStore(paths, undefined, { fetch: fetchImpl });

    const scan = await store.scanGitHubSkills(
      "https://github.com/acme/skills/tree/main/skills/engineering"
    );

    expect(scan).toMatchObject({
      owner: "acme",
      repo: "skills",
      ref: "main",
      rootPath: "skills/engineering",
      truncated: false
    });
    expect(scan.candidates).toEqual([
      expect.objectContaining({ id: "code-review", name: "Code Review", status: "ready" }),
      expect.objectContaining({ id: "research", name: "Research", status: "ready" })
    ]);

    const result = await store.importGitHubSkills(
      scan.candidates.map((candidate) => ({
        url: candidate.sourceUrl,
        id: candidate.id,
        ref: candidate.ref,
        remotePath: candidate.remotePath
      }))
    );

    expect(result.failed).toEqual([]);
    expect(result.imported.map((skill) => skill.id)).toEqual(["code-review", "research"]);
    await expect(
      readFile(join(paths.skillsLibraryDir, "research", "SKILL.md"), "utf8")
    ).resolves.toContain("Research primary sources");
  });

  it("imports a skill from a GitHub repository directory URL", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/agent-skills/contents/skills/reviewer?ref=main")) {
        return new Response(
          JSON.stringify([
            {
              type: "file",
              name: "SKILL.md",
              path: "skills/reviewer/SKILL.md",
              download_url: "https://raw.example/SKILL.md",
              sha: "skill-md-sha"
            },
            {
              type: "dir",
              name: "references",
              path: "skills/reviewer/references",
              sha: "refs-sha"
            }
          ])
        );
      }
      if (url.endsWith("/repos/acme/agent-skills/contents/skills/reviewer/references?ref=main")) {
        return new Response(
          JSON.stringify([
            {
              type: "file",
              name: "guide.md",
              path: "skills/reviewer/references/guide.md",
              download_url: "https://raw.example/guide.md",
              sha: "guide-sha"
            }
          ])
        );
      }
      if (url === "https://raw.example/SKILL.md") {
        return new Response("---\nname: reviewer\ndescription: GitHub skill.\n---\n# Reviewer\n");
      }
      if (url === "https://raw.example/guide.md") {
        return new Response("# Guide\n");
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const store = createSkillLibraryStore(paths, undefined, { fetch: fetchImpl });
    const imported = await store.importGitHubSkill({
      url: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
      id: "github-reviewer"
    });

    expect(imported).toMatchObject({
      id: "github-reviewer",
      name: "reviewer",
      description: "GitHub skill.",
      sourceType: "github",
      source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
      updatePolicy: "tracked",
      remoteRef: "main",
      remoteRevision: "1056668e8f218b8cadafa95d64b401fbf7d9e87c"
    });
    await expect(
      readFile(join(paths.skillsLibraryDir, "github-reviewer", "references", "guide.md"), "utf8")
    ).resolves.toBe("# Guide\n");

    await store.setUpdatePolicy({ id: "github-reviewer", policy: "untracked" });
    fetchImpl.mockClear();
    await expect(store.checkUpdates()).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(store.listSkills()).resolves.toEqual([
      expect.objectContaining({ id: "github-reviewer", updatePolicy: "untracked" })
    ]);
  });

  it("detects and updates GitHub-backed skills when the source directory changes", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    let version = "v1";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/agent-skills/contents/skills/reviewer?ref=main")) {
        return new Response(
          JSON.stringify([
            {
              type: "file",
              name: "SKILL.md",
              path: "skills/reviewer/SKILL.md",
              download_url: "https://raw.example/SKILL.md",
              sha: `skill-md-sha-${version}`
            }
          ])
        );
      }
      if (url === "https://raw.example/SKILL.md") {
        return new Response(`---\nname: reviewer\n---\n# ${version}\n`);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const store = createSkillLibraryStore(paths, undefined, { fetch: fetchImpl });
    await store.importGitHubSkill({
      url: "https://github.com/acme/agent-skills/tree/main/skills/reviewer"
    });

    version = "v2";
    const updates = await store.checkUpdates();

    expect(updates).toEqual([
      {
        id: "reviewer",
        name: "reviewer",
        sourceType: "github",
        currentRevision: "9e0a463d609626416ae0d7e8e4e2a2da6cb0f125",
        latestRevision: "bd3ab812f7c7c36d243ec501041be299e208ecc1",
        updateAvailable: true
      }
    ]);

    const updatePlan = await store.previewUpdate("reviewer");
    const updated = await store.updateSkill({ id: "reviewer", previewId: updatePlan.previewId! });

    expect(updated.remoteRevision).toBe("bd3ab812f7c7c36d243ec501041be299e208ecc1");
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")).resolves.toContain(
      "# v2"
    );
  });

  it("previews GitHub-backed skill updates before applying them", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    let version = "v1";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/repos/acme/agent-skills/contents/skills/reviewer?ref=main")) {
        return new Response(
          JSON.stringify([
            {
              type: "file",
              name: "SKILL.md",
              path: "skills/reviewer/SKILL.md",
              download_url: "https://raw.example/SKILL.md",
              sha: `skill-md-sha-${version}`
            }
          ])
        );
      }
      if (url === "https://raw.example/SKILL.md") {
        return new Response(`---\nname: reviewer\n---\n# ${version}\n`);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const store = createSkillLibraryStore(paths, undefined, { fetch: fetchImpl });
    await store.importGitHubSkill({
      url: "https://github.com/acme/agent-skills/tree/main/skills/reviewer"
    });

    version = "v2";
    const plan = await store.previewUpdate("reviewer");

    expect(plan).toMatchObject({
      id: "reviewer",
      name: "reviewer",
      sourceType: "github",
      source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
      currentRevision: "9e0a463d609626416ae0d7e8e4e2a2da6cb0f125",
      latestRevision: "bd3ab812f7c7c36d243ec501041be299e208ecc1",
      updateAvailable: true,
      errors: []
    });
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      path: "SKILL.md",
      before: "---\nname: reviewer\n---\n# v1\n",
      after: "---\nname: reviewer\n---\n# v2\n"
    });

    version = "v3";
    const updated = await store.updateSkill({ id: "reviewer", previewId: plan.previewId! });
    await expect(readFile(join(updated.path, "SKILL.md"), "utf8")).resolves.toContain("# v2");
    await expect(readFile(join(updated.path, "SKILL.md"), "utf8")).resolves.not.toContain("# v3");
  });

  it("merges same-name Library skills while choosing content and update source independently", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const alphaDir = join(paths.skillsLibraryDir, "reviewer-alpha");
    const betaDir = join(paths.skillsLibraryDir, "reviewer-beta");
    const profileDir = join(paths.profilesDir, "daily-coding");
    await mkdir(alphaDir, { recursive: true });
    await mkdir(betaDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(
      join(alphaDir, "SKILL.md"),
      "---\nname: reviewer\nversion: 1.0.0\n---\n# Keep this content\n",
      "utf8"
    );
    await writeFile(
      join(alphaDir, ".agentenv-skill.json"),
      JSON.stringify({ sourceType: "local", source: "/original/alpha", updatePolicy: "untracked" }),
      "utf8"
    );
    await writeFile(
      join(betaDir, "SKILL.md"),
      "---\nname: reviewer\nversion: 2.0.0\n---\n# Other content\n",
      "utf8"
    );
    await writeFile(
      join(betaDir, ".agentenv-skill.json"),
      JSON.stringify({
        sourceType: "github",
        source: "https://github.com/acme/reviewer/tree/main/skill",
        remoteRef: "main",
        remotePath: "skill",
        remoteRevision: "abcdef123456",
        updatePolicy: "tracked",
        upstream: {
          kind: "github",
          locator: "https://github.com/acme/reviewer/tree/main/skill",
          ref: "main",
          subpath: "skill",
          revision: "abcdef123456"
        }
      }),
      "utf8"
    );
    const originalProfile: ProfileDetail = {
      id: "daily-coding",
      profileDir,
      manifest: {
        id: "daily-coding",
        preferredTargetId: "opencode",
        name: "Daily Coding",
        description: "",
        version: 2
      },
      instructions: "",
      resources: {
        skills: [{ libraryId: "reviewer-beta", targetName: "reviewer", enabled: true }],
        mcpByTarget: {}
      }
    };
    let currentProfile = originalProfile;
    await writeFile(join(profileDir, "profile-state.json"), JSON.stringify(originalProfile), "utf8");
    const profileStore = {
      listProfiles: async () => [{
        id: currentProfile.id,
        preferredTargetId: "opencode",
        name: "Daily Coding",
        description: ""
      }],
      readProfile: async () => currentProfile,
      saveProfile: async (input: SaveProfileInput) => {
        currentProfile = { ...input, id: input.manifest.id, profileDir };
        await writeFile(join(profileDir, "profile-state.json"), JSON.stringify(currentProfile), "utf8");
        return currentProfile;
      }
    };
    const store = createSkillLibraryStore(paths, undefined, { profileStore });
    const targetPaths = {
      targetId: "opencode",
      configDir: join(paths.homeDir, ".config", "opencode"),
      instructionsPath: "",
      configPath: "",
      skillsDir: join(paths.homeDir, ".config", "opencode", "skills")
    };
    await store.deployLibrarySkill({
      targetPaths,
      targetName: "reviewer",
      libraryId: "reviewer-beta",
      profileId: "daily-coding"
    });

    const preview = await store.previewMerge("reviewer-alpha", [targetPaths]);
    expect(preview).toMatchObject({
      name: "reviewer",
      entries: [
        { id: "reviewer-alpha", profileNames: [] },
        { id: "reviewer-beta", profileNames: ["Daily Coding"] }
      ],
      profileCount: 1,
      installCount: 1
    });
    expect(preview.comparisons[0]).toMatchObject({
      leftId: "reviewer-alpha",
      rightId: "reviewer-beta",
      identical: false,
      changes: [expect.objectContaining({ path: "SKILL.md" })]
    });

    const result = await store.mergeSkills(
      {
        ids: preview.entries.map((entry) => entry.id),
        keepId: "reviewer-alpha",
        sourceId: "reviewer-beta",
        expectedContentHashes: Object.fromEntries(
          preview.entries.map((entry) => [entry.id, entry.contentHash])
        )
      },
      [targetPaths]
    );

    expect(result).toMatchObject({
      removedIds: ["reviewer-beta"],
      profilesUpdated: 1,
      installsUpdated: 1
    });
    await expect(store.listSkills()).resolves.toEqual([
      expect.objectContaining({
        id: "reviewer-alpha",
        sourceType: "github",
        source: "https://github.com/acme/reviewer/tree/main/skill",
        updatePolicy: "tracked"
      })
    ]);
    await expect(readFile(join(alphaDir, "SKILL.md"), "utf8")).resolves.toContain(
      "# Keep this content"
    );
    expect(currentProfile.resources.skills).toEqual([
      { libraryId: "reviewer-alpha", targetName: "reviewer", enabled: true }
    ]);
    await expect(readlink(join(targetPaths.skillsDir, "reviewer"))).resolves.toBe(alphaDir);
    await expect(
      readFile(`${join(targetPaths.skillsDir, "reviewer")}.agentenv-owner.json`, "utf8")
    ).resolves.toContain('"source": "skills-library/reviewer-alpha"');

    await store.rollbackSkillCleanup(result.backupId);
    await expect(readFile(join(betaDir, "SKILL.md"), "utf8")).resolves.toContain("# Other content");
    await expect(readlink(join(targetPaths.skillsDir, "reviewer"))).resolves.toBe(betaDir);
    await expect(readFile(join(profileDir, "profile-state.json"), "utf8")).resolves.toContain(
      '"libraryId":"reviewer-beta"'
    );
  });

  it("recognizes identical same-name Library skills and still preserves the chosen source", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-skill-library-"));
    const paths = createPaths({ appDataRoot: join(root, "app-data"), homeDir: join(root, "home") });
    const localDir = join(paths.skillsLibraryDir, "reviewer-local");
    const githubDir = join(paths.skillsLibraryDir, "reviewer-github");
    const content = "---\nname: reviewer\n---\n# Same content\n";
    for (const path of [localDir, githubDir]) {
      await mkdir(path, { recursive: true });
      await writeFile(join(path, "SKILL.md"), content, "utf8");
    }
    await writeFile(
      join(githubDir, ".agentenv-skill.json"),
      JSON.stringify({
        sourceType: "github",
        source: "https://github.com/acme/reviewer/tree/main/skill",
        updatePolicy: "tracked"
      }),
      "utf8"
    );
    const profileStore = {
      listProfiles: async () => [],
      readProfile: async () => { throw new Error("unexpected profile read"); },
      saveProfile: async () => { throw new Error("unexpected profile save"); }
    };
    const store = createSkillLibraryStore(paths, undefined, { profileStore });

    const preview = await store.previewMerge("reviewer-local", []);
    expect(preview.comparisons).toEqual([
      expect.objectContaining({ identical: true, changes: [] })
    ]);

    await writeFile(join(githubDir, "SKILL.md"), `${content}\nChanged after preview.\n`, "utf8");
    await expect(store.mergeSkills({
      ids: preview.entries.map((entry) => entry.id),
      keepId: "reviewer-local",
      sourceId: "reviewer-github",
      expectedContentHashes: Object.fromEntries(
        preview.entries.map((entry) => [entry.id, entry.contentHash])
      )
    }, [])).rejects.toThrow("changed after the merge preview");
    await expect(readFile(join(githubDir, "SKILL.md"), "utf8")).resolves.toContain(
      "Changed after preview"
    );
    await writeFile(join(githubDir, "SKILL.md"), content, "utf8");
    const refreshedPreview = await store.previewMerge("reviewer-local", []);

    const result = await store.mergeSkills({
      ids: refreshedPreview.entries.map((entry) => entry.id),
      keepId: "reviewer-local",
      sourceId: "reviewer-github",
      expectedContentHashes: Object.fromEntries(
        refreshedPreview.entries.map((entry) => [entry.id, entry.contentHash])
      )
    }, []);

    expect(result.removedIds).toEqual(["reviewer-github"]);
    await expect(store.listSkills()).resolves.toEqual([
      expect.objectContaining({
        id: "reviewer-local",
        sourceType: "github",
        updatePolicy: "tracked"
      })
    ]);
  });
});
