import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      source: sourceDir
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
});
