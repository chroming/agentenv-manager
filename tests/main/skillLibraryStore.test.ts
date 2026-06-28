import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      source: undefined
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
    ).resolves.not.toContain(sourceDir);
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
  });

  it("removes a skill from the central library without mutating its source directory", async () => {
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

    await store.removeSkill("shared-reviewer");

    await expect(store.listSkills()).resolves.toEqual([]);
    await expect(readFile(join(sourceDir, "SKILL.md"), "utf8")).resolves.toContain("# Reviewer");
    await expect(
      readFile(join(paths.skillsLibraryDir, "shared-reviewer", "SKILL.md"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
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
        skillKey: "reviewer"
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
    await writeFile(join(sourceDir, "SKILL.md"), "---\nname: reviewer\n---\n\n# v2\n", "utf8");

    const updated = await store.updateSkill("reviewer");

    expect(updated.contentHash).not.toBe(first.contentHash);
    await expect(readFile(join(paths.skillsLibraryDir, "reviewer", "SKILL.md"), "utf8")).resolves.toContain(
      "# v2"
    );
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
      remoteRef: "main",
      remoteRevision: "1056668e8f218b8cadafa95d64b401fbf7d9e87c"
    });
    await expect(
      readFile(join(paths.skillsLibraryDir, "github-reviewer", "references", "guide.md"), "utf8")
    ).resolves.toBe("# Guide\n");
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
