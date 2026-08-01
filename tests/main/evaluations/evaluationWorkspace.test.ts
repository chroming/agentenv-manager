import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEvaluationWorkspace } from "../../../src/main/evaluations/evaluationWorkspace";
import { createGitCommandRunner } from "../../../src/main/skillSources/gitCommandRunner";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import type { ProfileDetail, SkillLibraryEntry } from "../../../src/shared/types";

const gitPath = (process.env.PATH ?? "")
  .split(delimiter)
  .map((entry) => join(entry, process.platform === "win32" ? "git.exe" : "git"))
  .find(existsSync);

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

describe.skipIf(!gitPath)("evaluation workspace", () => {
  it("removes only stale evaluation run directories", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-cleanup-"));
    const cacheRoot = join(root, "cache");
    const staleRun = join(cacheRoot, "run-stale123");
    const unrelated = join(cacheRoot, "repository-cache");
    await Promise.all([
      mkdir(staleRun, { recursive: true }),
      mkdir(unrelated, { recursive: true })
    ]);
    const git = createGitCommandRunner({ executablePath: gitPath! });
    const workspace = createEvaluationWorkspace({ cacheRoot, git });

    await workspace.cleanupStale();

    expect(existsSync(staleRun)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    git.dispose();
  });

  it("clones only HEAD, snapshots Profile resources, and never changes the original project or Agent", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-workspace-"));
    if (process.platform !== "win32") await chmod(root, 0o700);
    const git = createGitCommandRunner({ executablePath: gitPath! });
    const project = join(root, "project");
    const sourceHome = join(root, "source-home");
    const skillPath = join(root, "library", "review-skill");
    await Promise.all([
      mkdir(project, { recursive: true }),
      mkdir(skillPath, { recursive: true })
    ]);
    await mkdir(join(project, ".opencode", "skills", "project-only"), { recursive: true });
    await writeFile(join(project, "README.md"), "committed\n");
    await writeFile(join(project, "AGENTS.md"), "# Project instructions\n");
    await writeFile(join(project, "opencode.json"), "{\"model\":\"project/override\"}\n");
    await writeFile(
      join(project, ".opencode", "skills", "project-only", "SKILL.md"),
      "# Project-only Skill\n"
    );
    await git.run(["-C", project, "init"]);
    await git.run(["-C", project, "config", "user.name", "AgentEnv Test"]);
    await git.run(["-C", project, "config", "user.email", "test@agentenv.local"]);
    await git.run(["-C", project, "add", "."]);
    await git.run(["-C", project, "commit", "-m", "initial"]);
    await writeFile(join(project, "README.md"), "uncommitted\n");
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");

    const skill: SkillLibraryEntry = {
      id: "review-skill",
      name: "review-skill",
      description: "Review changes",
      path: skillPath,
      sourceType: "local",
      globallyEnabled: true,
      updatePolicy: "untracked",
      contentHash: "library-hash",
      updatedAt: new Date().toISOString()
    };
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: sourceHome });
    await mkdir(sourcePaths.configDir, { recursive: true });
    await writeFile(sourcePaths.instructionsPath, "# Real Agent\n");
    const workspace = createEvaluationWorkspace({
      cacheRoot: join(root, "cache"),
      git
    });
    const projectSnapshot = await workspace.inspectProject(project);
    expect(projectSnapshot.hasUncommittedChanges).toBe(true);

    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      project: projectSnapshot,
      sourceTargetPaths: sourcePaths
    });

    expect(await readFile(join(prepared.project, "README.md"), "utf8")).toBe("committed\n");
    expect(existsSync(join(prepared.project, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(prepared.project, "opencode.json"))).toBe(false);
    expect(existsSync(join(prepared.project, ".opencode"))).toBe(false);
    expect(await readFile(prepared.resources.targetPaths.instructionsPath, "utf8"))
      .toBe("# Isolated instructions\n");
    expect(await readFile(
      join(prepared.resources.targetPaths.skillsDir!, "review-skill", "SKILL.md"),
      "utf8"
    )).toBe("# Review Skill\n");

    await writeFile(join(prepared.project, "generated.txt"), "evaluation output\n");
    const changes = await workspace.readChanges(prepared);
    expect(changes.changedFiles).toEqual(["generated.txt"]);
    expect(changes.diff).toContain("evaluation output");
    expect(await readFile(join(prepared.project, "AGENTS.md"), "utf8"))
      .toBe("# Project instructions\n");
    expect(await readFile(join(prepared.project, "opencode.json"), "utf8"))
      .toBe("{\"model\":\"project/override\"}\n");
    expect(await readFile(
      join(prepared.project, ".opencode", "skills", "project-only", "SKILL.md"),
      "utf8"
    )).toBe("# Project-only Skill\n");
    await expect(workspace.verifyOriginals(prepared)).resolves.toBeUndefined();
    expect(await readFile(join(project, "README.md"), "utf8")).toBe("uncommitted\n");
    expect(await readFile(sourcePaths.instructionsPath, "utf8")).toBe("# Real Agent\n");

    await workspace.cleanup(prepared);
    expect(existsSync(prepared.root)).toBe(false);
    git.dispose();
  });

  it("rejects a result when the original Agent changes during evaluation", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-stale-"));
    const git = createGitCommandRunner({ executablePath: gitPath! });
    const project = join(root, "project");
    const skillPath = join(root, "skill");
    await Promise.all([mkdir(project), mkdir(skillPath)]);
    await writeFile(join(project, "README.md"), "committed\n");
    await git.run(["-C", project, "init"]);
    await git.run(["-C", project, "config", "user.name", "AgentEnv Test"]);
    await git.run(["-C", project, "config", "user.email", "test@agentenv.local"]);
    await git.run(["-C", project, "add", "README.md"]);
    await git.run(["-C", project, "commit", "-m", "initial"]);
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");
    const skill: SkillLibraryEntry = {
      id: "review-skill",
      name: "review-skill",
      description: "",
      path: skillPath,
      sourceType: "local",
      globallyEnabled: true,
      updatePolicy: "untracked",
      contentHash: "library-hash",
      updatedAt: new Date().toISOString()
    };
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: join(root, "home") });
    await mkdir(sourcePaths.configDir, { recursive: true });
    await writeFile(sourcePaths.instructionsPath, "before\n");
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache"), git });
    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      project: await workspace.inspectProject(project),
      sourceTargetPaths: sourcePaths
    });

    await writeFile(sourcePaths.instructionsPath, "changed outside\n");
    await expect(workspace.verifyOriginals(prepared)).rejects.toThrow(
      "real Agent changed during evaluation"
    );
    await workspace.cleanup(prepared);
    git.dispose();
  });

  it("rejects a result when an already-dirty original project file changes again", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-project-stale-"));
    const git = createGitCommandRunner({ executablePath: gitPath! });
    const project = join(root, "project");
    const skillPath = join(root, "skill");
    await Promise.all([mkdir(project), mkdir(skillPath)]);
    await writeFile(join(project, "README.md"), "committed\n");
    await git.run(["-C", project, "init"]);
    await git.run(["-C", project, "config", "user.name", "AgentEnv Test"]);
    await git.run(["-C", project, "config", "user.email", "test@agentenv.local"]);
    await git.run(["-C", project, "add", "README.md"]);
    await git.run(["-C", project, "commit", "-m", "initial"]);
    await writeFile(join(project, "README.md"), "dirty before preview\n");
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");
    const skill: SkillLibraryEntry = {
      id: "review-skill",
      name: "review-skill",
      description: "",
      path: skillPath,
      sourceType: "local",
      globallyEnabled: true,
      updatePolicy: "untracked",
      contentHash: "library-hash",
      updatedAt: new Date().toISOString()
    };
    const adapter = createOpenCodeTargetAdapter();
    const sourcePaths = adapter.createTargetPaths({ homeDir: join(root, "home") });
    const workspace = createEvaluationWorkspace({ cacheRoot: join(root, "cache"), git });
    const prepared = await workspace.prepare({
      adapter,
      profile: profileFor(skill),
      librarySkills: [skill],
      project: await workspace.inspectProject(project),
      sourceTargetPaths: sourcePaths
    });

    await writeFile(join(project, "README.md"), "dirty after preview\n");
    await expect(workspace.verifyOriginals(prepared)).rejects.toThrow(
      "original project changed during evaluation"
    );
    await workspace.cleanup(prepared);
    git.dispose();
  });
});
