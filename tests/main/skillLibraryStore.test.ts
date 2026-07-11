import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPaths } from "../../src/main/paths";
import { createSkillLibraryStore } from "../../src/main/skillLibraryStore";

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
        updatePolicy: "untracked",
        contentHash: expect.any(String),
        updatedAt: expect.any(String)
      }
    ]);
    await expect(
      readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")
    ).resolves.toContain("# Reviewer");
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
    const updated = await store.updateSkill("reviewer");

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
        skillKey: "reviewer",
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
    await expect(readFile(join(targetDir, ".agentenv-owner.json"), "utf8")).resolves.toContain(
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
      libraryId: "shared-reviewer"
    });
    expect(openCodeInventory[0]).toMatchObject({
      status: "managed",
      libraryId: "shared-reviewer"
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
    await expect(readFile(join(targetCopy, ".agentenv-owner.json"), "utf8")).resolves.toContain(
      '"source": "skills-library/reviewer"'
    );
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

    const updated = await store.updateSkill("reviewer");

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

    const updated = await store.updateSkill("reviewer");

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
  });
});
