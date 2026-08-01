import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvaluationWorkspace } from "../../../src/main/evaluations/evaluationWorkspace";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import type { ProfileDetail, SkillLibraryEntry } from "../../../src/shared/types";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const profileFor = (skill: SkillLibraryEntry): ProfileDetail => ({
  id: "eval-profile",
  manifest: {
    id: "eval-profile",
    name: "Eval Profile",
    description: "",
    preferredTargetId: "opencode",
    version: 2
  },
  instructions: "# Isolated instructions\n",
  resources: {
    skills: [{ libraryId: skill.id, targetName: skill.name, enabled: true }],
    managementByTarget: {
      opencode: { instructions: "manage", skills: "manage" }
    },
    mcpByTarget: { opencode: { mode: "disable", selections: [] } }
  }
});

const librarySkill = (path: string): SkillLibraryEntry => ({
  id: "review-skill",
  name: "review-skill",
  description: "Review changes",
  path,
  sourceType: "local",
  globallyEnabled: true,
  updatePolicy: "untracked",
  contentHash: "library-hash",
  updatedAt: new Date().toISOString()
});

describe("evaluation workspace", () => {
  it("removes only stale comparison run directories", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-cleanup-"));
    const cacheRoot = join(root, "cache");
    const staleRun = join(cacheRoot, "run-stale123");
    const unrelated = join(cacheRoot, "repository-cache");
    await Promise.all([
      mkdir(staleRun, { recursive: true }),
      mkdir(unrelated, { recursive: true })
    ]);
    const workspace = createEvaluationWorkspace({ cacheRoot });

    await workspace.cleanupStale();

    expect(existsSync(staleRun)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("creates an empty isolated Workspace without requiring a Git project", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-empty-"));
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });
    const snapshot = await workspace.inspectWorkspace({ kind: "empty" });
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: join(root, "source-home") });
    const skillPath = join(root, "library", "review-skill");
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");
    const skill = librarySkill(skillPath);

    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      workspace: snapshot,
      sourceTargetPaths: sourcePaths
    });

    expect(snapshot.summary).toMatchObject({ kind: "empty", fileCount: 0, totalBytes: 0 });
    expect(await workspace.readChanges(prepared)).toMatchObject({ changedFiles: [] });
    await expect(workspace.verifyOriginals(prepared)).resolves.toBeUndefined();
    await workspace.cleanup(prepared);
  });

  it("snapshots the current contents of a non-Git folder and never changes the original folder or Agent", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-folder-"));
    if (process.platform !== "win32") await chmod(root, 0o700);
    const project = join(root, "workspace");
    const sourceHome = join(root, "source-home");
    const skillPath = join(root, "library", "review-skill");
    await Promise.all([
      mkdir(join(project, ".opencode", "skills", "project-only"), { recursive: true }),
      mkdir(skillPath, { recursive: true })
    ]);
    await writeFile(join(project, "README.md"), "current local content\n");
    await writeFile(join(project, "AGENTS.md"), "# Project instructions\n");
    await writeFile(join(project, "opencode.json"), "{\"model\":\"project/override\"}\n");
    await writeFile(
      join(project, ".opencode", "skills", "project-only", "SKILL.md"),
      "# Project-only Skill\n"
    );
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");

    const skill = librarySkill(skillPath);
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome });
    await mkdir(sourcePaths.configDir, { recursive: true });
    await writeFile(sourcePaths.instructionsPath, "# Real Agent\n");
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });
    const snapshot = await workspace.inspectWorkspace({ kind: "folder", path: project });

    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      workspace: snapshot,
      sourceTargetPaths: sourcePaths
    });

    expect(snapshot.summary.git).toBeUndefined();
    expect(await readFile(join(prepared.project, "README.md"), "utf8"))
      .toBe("current local content\n");
    expect(existsSync(join(prepared.project, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(prepared.project, "opencode.json"))).toBe(false);
    expect(existsSync(join(prepared.project, ".opencode"))).toBe(false);
    expect(await readFile(prepared.resources.targetPaths.instructionsPath, "utf8"))
      .toBe("# Isolated instructions\n");
    expect(await readFile(
      join(prepared.resources.targetPaths.skillsDir!, "review-skill", "SKILL.md"),
      "utf8"
    )).toBe("# Review Skill\n");

    await mkdir(join(prepared.project, ".opencode", "skills", "generated"), { recursive: true });
    await writeFile(join(prepared.project, "AGENTS.md"), "# Generated instructions\n");
    await writeFile(
      join(prepared.project, ".opencode", "skills", "generated", "SKILL.md"),
      "# Generated Skill\n"
    );
    await writeFile(join(prepared.project, "generated.txt"), "comparison output\n");
    const changes = await workspace.readChanges(prepared);
    expect(changes.changedFiles).toEqual(["generated.txt"]);
    expect(changes.diff).toContain("comparison output");
    expect(await readFile(join(prepared.project, "AGENTS.md"), "utf8"))
      .toBe("# Project instructions\n");
    expect(await readFile(
      join(prepared.project, ".opencode", "skills", "project-only", "SKILL.md"),
      "utf8"
    )).toBe("# Project-only Skill\n");
    expect(existsSync(join(prepared.project, ".opencode", "skills", "generated"))).toBe(false);
    await expect(workspace.verifyOriginals(prepared)).resolves.toBeUndefined();
    expect(await readFile(join(project, "README.md"), "utf8"))
      .toBe("current local content\n");
    expect(await readFile(sourcePaths.instructionsPath, "utf8")).toBe("# Real Agent\n");

    await workspace.cleanup(prepared);
    expect(existsSync(prepared.root)).toBe(false);
  });

  it("excludes links that escape the selected folder", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-link-"));
    const folder = join(root, "workspace");
    const outside = join(root, "outside.txt");
    await mkdir(folder);
    await writeFile(outside, "private\n");
    await symlink(outside, join(folder, "outside-link"));
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });

    const snapshot = await workspace.inspectWorkspace({ kind: "folder", path: folder });

    expect(snapshot.summary.omittedCount).toBe(1);
    expect(snapshot.entries).toEqual([]);
    expect(snapshot.warnings[0]).toContain("points outside");
  });

  it("omits sensitive files and generated dependency trees from folder snapshots", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-sensitive-"));
    const folder = join(root, "workspace");
    await Promise.all([
      mkdir(join(folder, "src"), { recursive: true }),
      mkdir(join(folder, "node_modules", "package"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(join(folder, "src", "index.ts"), "export const value = 1;\n"),
      writeFile(join(folder, ".env"), "API_TOKEN=private\n"),
      writeFile(join(folder, "credentials.json"), "{\"token\":\"private\"}\n"),
      writeFile(join(folder, "node_modules", "package", "index.js"), "generated\n")
    ]);
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });

    const snapshot = await workspace.inspectWorkspace({ kind: "folder", path: folder });

    expect(snapshot.entries.map((entry) => entry.path)).toEqual(["src", "src/index.ts"]);
    expect(snapshot.summary.omittedCount).toBe(3);
    expect(snapshot.warnings.join("\n")).toContain("may contain credentials");
    expect(snapshot.warnings.join("\n")).not.toContain("node_modules");
  });

  it("excludes escaping links and credential files from Library Skill snapshots", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-skill-link-"));
    const skillPath = join(root, "library", "review-skill");
    const outside = join(root, "outside-secret.txt");
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");
    await writeFile(join(skillPath, ".env"), "TOKEN=private\n");
    await writeFile(outside, "private\n");
    await symlink(outside, join(skillPath, "outside-link"));
    const skill = librarySkill(skillPath);
    const adapter = createOpenCodeTargetAdapter();
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });

    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      workspace: await workspace.inspectWorkspace({ kind: "empty" }),
      sourceTargetPaths: adapter.createTargetPaths({ homeDir: join(root, "source-home") })
    });

    const copiedSkill = join(prepared.resources.targetPaths.skillsDir!, "review-skill");
    expect(existsSync(join(copiedSkill, "SKILL.md"))).toBe(true);
    expect(existsSync(join(copiedSkill, ".env"))).toBe(false);
    expect(existsSync(join(copiedSkill, "outside-link"))).toBe(false);
    expect(prepared.resources.warnings.join("\n")).toContain("may contain credentials");
    expect(prepared.resources.warnings.join("\n")).toContain("points outside");
    expect(await readFile(outside, "utf8")).toBe("private\n");
    await workspace.cleanup(prepared);
  });

  it("rejects a Library Skill whose root is a symbolic link", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-skill-root-link-"));
    const actualSkill = join(root, "actual-skill");
    const linkedSkill = join(root, "linked-skill");
    await mkdir(actualSkill);
    await writeFile(join(actualSkill, "SKILL.md"), "# Review Skill\n");
    await symlink(actualSkill, linkedSkill);
    const skill = librarySkill(linkedSkill);
    const adapter = createOpenCodeTargetAdapter();
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });

    await expect(workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      workspace: await workspace.inspectWorkspace({ kind: "empty" }),
      sourceTargetPaths: adapter.createTargetPaths({ homeDir: join(root, "source-home") })
    })).rejects.toThrow("Library Skill must be a regular directory");
  });

  it("freezes a current Agent Skill that is loaded through a directory link", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-current-link-"));
    const actualSkill = join(root, "actual-current-skill");
    const libraryPath = join(root, "library-skill");
    await Promise.all([mkdir(actualSkill), mkdir(libraryPath)]);
    await writeFile(join(actualSkill, "SKILL.md"), "# Current linked Skill\n");
    await writeFile(join(libraryPath, "SKILL.md"), "# Library Skill\n");
    const library = librarySkill(libraryPath);
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: join(root, "source-home") });
    await mkdir(sourcePaths.skillsDir!, { recursive: true });
    await symlink(actualSkill, join(sourcePaths.skillsDir!, "current-linked"));
    const currentProfile = profileFor(library);
    currentProfile.resources.managementByTarget = {
      opencode: { instructions: "disable", skills: "ignore" }
    };
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });

    const prepared = await workspace.prepare({
      adapter,
      profile: currentProfile,
      librarySkills: [library],
      workspace: await workspace.inspectWorkspace({ kind: "empty" }),
      sourceTargetPaths: sourcePaths
    });

    expect(await readFile(
      join(prepared.resources.targetPaths.skillsDir!, "current-linked", "SKILL.md"),
      "utf8"
    )).toBe("# Current linked Skill\n");
    expect(prepared.resources.warnings.join("\n")).toContain("symbolic link");
    await workspace.cleanup(prepared);
  });

  it("rejects a result when the original Agent changes during comparison", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-agent-stale-"));
    const folder = join(root, "workspace");
    const skillPath = join(root, "skill");
    await Promise.all([mkdir(folder), mkdir(skillPath)]);
    await writeFile(join(folder, "README.md"), "current\n");
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");
    const skill = librarySkill(skillPath);
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: join(root, "home") });
    await mkdir(sourcePaths.configDir, { recursive: true });
    await writeFile(sourcePaths.instructionsPath, "before\n");
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });
    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      workspace: await workspace.inspectWorkspace({ kind: "folder", path: folder }),
      sourceTargetPaths: sourcePaths
    });

    await writeFile(sourcePaths.instructionsPath, "changed outside\n");
    await expect(workspace.verifyOriginals(prepared)).rejects.toThrow(
      "real Agent changed during comparison"
    );
    await workspace.cleanup(prepared);
  });

  it("rejects a result when the selected folder changes during comparison", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-comparison-folder-stale-"));
    const folder = join(root, "workspace");
    const skillPath = join(root, "skill");
    await Promise.all([mkdir(folder), mkdir(skillPath)]);
    await writeFile(join(folder, "README.md"), "before\n");
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");
    const skill = librarySkill(skillPath);
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: join(root, "home") });
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache") });
    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      workspace: await workspace.inspectWorkspace({ kind: "folder", path: folder }),
      sourceTargetPaths: sourcePaths
    });

    await writeFile(join(folder, "README.md"), "after\n");
    await expect(workspace.verifyOriginals(prepared)).rejects.toThrow(
      "original Workspace changed during comparison"
    );
    await workspace.cleanup(prepared);
  });
});
