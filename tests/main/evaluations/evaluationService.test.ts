import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEvaluationService,
  type EvaluationService
} from "../../../src/main/evaluations/evaluationService";
import {
  EvaluationProcessError,
  type EvaluationProcessRunner
} from "../../../src/main/evaluations/evaluationProcessRunner";
import { createEvaluationResultStore } from "../../../src/main/evaluations/evaluationResultStore";
import type { EvaluationResultStore } from "../../../src/main/evaluations/evaluationResultStore";
import type { ProfileStore } from "../../../src/main/profileStore";
import type { SkillLibraryStore } from "../../../src/main/skillLibraryStore";
import { createGitCommandRunner, type GitCommandRunner } from "../../../src/main/skillSources/gitCommandRunner";
import type { TargetDiscoveryService } from "../../../src/main/targetDiscovery";
import { createOpenCodeTargetAdapter } from "../../../src/main/targets/opencodeTarget";
import { createTargetRegistry } from "../../../src/main/targets/registry";
import type {
  EvaluationEvent,
  EvaluationLaunchSpec
} from "../../../src/main/targets/types";
import type {
  OneShotEvaluationRun,
  ProfileDetail,
  SkillLibraryEntry,
  TargetInfo
} from "../../../src/shared/types";

const gitPath = (process.env.PATH ?? "")
  .split(delimiter)
  .map((entry) => join(entry, process.platform === "win32" ? "git.exe" : "git"))
  .find(existsSync);

let root = "";
let git: GitCommandRunner | undefined;
let service: EvaluationService | undefined;

afterEach(async () => {
  service?.dispose();
  git?.dispose();
  service = undefined;
  git = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const waitForTerminal = async (runId: string) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const run = await service!.read({ runId });
    if (run && !["preparing", "running", "cancelling"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Evaluation did not finish");
};

describe.skipIf(!gitPath)("evaluation service", () => {
  const setup = async (
    processRunner: EvaluationProcessRunner,
    resultStore?: EvaluationResultStore
  ) => {
    root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-service-"));
    const home = join(root, "home");
    const project = join(root, "project");
    const skillPath = join(root, "library", "review-skill");
    const cacheRoot = join(root, "cache", "evaluations");
    const reportPath = join(root, "data", "evaluations", "latest.json");
    await Promise.all([
      mkdir(project, { recursive: true }),
      mkdir(skillPath, { recursive: true })
    ]);
    await writeFile(join(project, "README.md"), "original project\n");
    git = createGitCommandRunner({ executablePath: gitPath! });
    await git.run(["-C", project, "init"]);
    await git.run(["-C", project, "config", "user.name", "AgentEnv Test"]);
    await git.run(["-C", project, "config", "user.email", "test@agentenv.local"]);
    await git.run(["-C", project, "add", "README.md"]);
    await git.run(["-C", project, "commit", "-m", "initial"]);
    await writeFile(join(skillPath, "SKILL.md"), "# Review Skill\n");

    const skill: SkillLibraryEntry = {
      id: "review-skill",
      name: "review-skill",
      description: "Review changes",
      path: skillPath,
      sourceType: "local",
      globallyEnabled: true,
      updatePolicy: "untracked",
      contentHash: "profile-library-hash",
      updatedAt: new Date().toISOString()
    };
    const profile: ProfileDetail = {
      id: "daily-coding",
      manifest: {
        id: "daily-coding",
        name: "Daily Coding",
        description: "",
        preferredTargetId: "opencode",
        version: 2
      },
      instructions: "# Evaluation instructions\n",
      resources: {
        skills: [{ libraryId: skill.id, targetName: skill.name, enabled: true }],
        managementByTarget: {
          opencode: { instructions: "manage", skills: "manage" }
        },
        mcpByTarget: { opencode: { mode: "disable", selections: [] } }
      }
    };
    const adapter = createOpenCodeTargetAdapter();
    const paths = adapter.createTargetPaths({ homeDir: home });
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.instructionsPath, "# Real OpenCode instructions\n");
    const target: TargetInfo = {
      ...adapter.descriptor,
      paths,
      health: {
        status: "ready",
        installationFound: true,
        installationEvidence: [{ kind: "command", label: "Command", path: process.execPath }],
        executableName: "opencode",
        executablePath: process.execPath,
        executableFound: true,
        canWrite: true,
        summary: "Ready",
        checks: []
      },
      conversationCapabilities: {
        history: { state: "unsupported", evidence: [] },
        openOriginal: { state: "unsupported", evidence: [] },
        continue: { state: "unsupported", evidence: [] }
      }
    };
    const profileStore = {
      readProfile: vi.fn(async () => profile)
    } as unknown as ProfileStore;
    const listSkills = vi.fn(async () => [skill]);
    const skillLibraryStore = {
      listSkills
    } as unknown as Pick<SkillLibraryStore, "listSkills">;
    const targetDiscoveryService = {
      listTargets: vi.fn(async () => [target])
    } as TargetDiscoveryService;
    service = createEvaluationService({
      cacheRoot,
      homeDir: home,
      profileStore,
      skillLibraryStore,
      targetRegistry: createTargetRegistry([adapter]),
      targetDiscoveryService,
      processRunner,
      resultStore: resultStore ?? createEvaluationResultStore({ path: reportPath }),
      loadGitRunner: async () => git!
    });
    return { project, paths, cacheRoot, reportPath, profile, listSkills };
  };

  it("runs a saved Profile in an isolated clone and persists proof only after cleanup", async () => {
    let isolatedInstructions = "";
    let isolatedSkill = "";
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run: async (spec, parseEvent, options) => {
        isolatedInstructions = await readFile(
          join(spec.env.OPENCODE_CONFIG_DIR!, "AGENTS.md"),
          "utf8"
        );
        isolatedSkill = await readFile(
          join(spec.env.OPENCODE_CONFIG_DIR!, "skills", "review-skill", "SKILL.md"),
          "utf8"
        );
        await writeFile(join(spec.cwd, "generated.txt"), "created by evaluation\n");
        for (const line of [
          JSON.stringify({ type: "text", part: { text: "Finished" } }),
          JSON.stringify({
            type: "step_finish",
            part: { modelID: "test/model", tokens: { input: 8, output: 3 } }
          })
        ]) {
          const event = parseEvent(line);
          if (event) options?.onEvent?.(event);
        }
        return { exitCode: 0, stderr: "" };
      },
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const { project, paths, cacheRoot, reportPath } = await setup(processRunner);
    const preview = await service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project
    });
    const started = await service!.start({ previewId: preview.previewId, prompt: "Add a file" });
    const terminal = await waitForTerminal(started.runId);

    expect(terminal.status).toBe("completed");
    expect(terminal.result).toMatchObject({
      finalResponse: "Finished",
      changedFiles: ["generated.txt"],
      model: "test/model",
      usage: { inputTokens: 8, outputTokens: 3 },
      fidelity: "partial"
    });
    expect(terminal.result?.usage?.totalTokens).toBeUndefined();
    expect(isolatedInstructions).toBe("# Evaluation instructions\n");
    expect(isolatedSkill).toBe("# Review Skill\n");
    expect(existsSync(join(project, "generated.txt"))).toBe(false);
    expect(await readFile(paths.instructionsPath, "utf8")).toBe("# Real OpenCode instructions\n");
    expect(await readdir(cacheRoot)).toEqual([]);
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({ runId: started.runId });
  });

  it("rejects a stale preview before creating a model run", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stderr: "" }));
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run,
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const { project } = await setup(processRunner);
    const preview = await service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project
    });
    await writeFile(join(project, "uncommitted.txt"), "changed after preview\n");

    await expect(service!.start({ previewId: preview.previewId, prompt: "Do work" }))
      .rejects.toThrow("Project changed after evaluation preview");
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a missing enabled Library Skill before previewing a run", async () => {
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run: vi.fn(),
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const { project, listSkills } = await setup(processRunner);
    listSkills.mockResolvedValue([]);

    await expect(service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project
    })).rejects.toThrow("Profile Skill review-skill is missing from Library");
    expect(processRunner.run).not.toHaveBeenCalled();
  });

  it("reports an empty managed Instructions file as not included", async () => {
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run: vi.fn(),
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const { project, profile } = await setup(processRunner);
    profile.instructions = "";

    const preview = await service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project
    });
    expect(preview.resources.instructions.includedCount).toBe(0);
  });

  it("reports resource modes consistently and excludes MCPs without a second decision", async () => {
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run: vi.fn(),
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const { project, profile } = await setup(processRunner);
    profile.resources.mcpByTarget.opencode = {
      mode: "manage",
      selections: [
        { name: "docs", enabled: true },
        { name: "browser", enabled: false }
      ]
    };

    const preview = await service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project,
      excludeMcp: false
    });

    expect(preview.resources).toMatchObject({
      instructions: { mode: "manage", includedCount: 1 },
      skills: { mode: "manage", includedCount: 1 },
      mcp: { mode: "manage", includedCount: 0, omittedCount: 1 }
    });
    expect(preview.fidelity).toBe("partial");
    expect(preview.requiresMcpExclusion).toBe(false);
  });

  it("does not expose an unsanitized result when report persistence fails", async () => {
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run: async (_spec, parseEvent, options) => {
        const event = parseEvent(JSON.stringify({
          type: "text",
          part: { text: "password=raw-secret" }
        }));
        if (event) options?.onEvent?.(event);
        return { exitCode: 0, stderr: "" };
      },
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const resultStore: EvaluationResultStore = {
      readLatest: vi.fn(async () => undefined),
      saveLatest: vi.fn(async () => {
        throw new Error("Report storage is unavailable");
      })
    };
    const { project } = await setup(processRunner, resultStore);
    const preview = await service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project
    });
    const started = await service!.start({
      previewId: preview.previewId,
      prompt: "Do work"
    });
    const terminal = await waitForTerminal(started.runId);

    expect(terminal.status).toBe("failed-to-run");
    expect(terminal.error).toBe("Report storage is unavailable");
    expect(terminal.result).toBeUndefined();
  });

  it("cancels an active run and removes its temporary workspace", async () => {
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run: async (_spec: EvaluationLaunchSpec, _parse, options) =>
        new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new EvaluationProcessError("cancelled", "Evaluation was cancelled"));
          }, { once: true });
        }),
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const { project, cacheRoot } = await setup(processRunner);
    const preview = await service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project
    });
    const firstStart = service!.start({ previewId: preview.previewId, prompt: "Wait" });
    await expect(service!.start({ previewId: preview.previewId, prompt: "Duplicate" }))
      .rejects.toThrow("Another evaluation is already running");
    const started = await firstStart;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await service!.read({ runId: started.runId });
      if (current?.status === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await service!.cancel(started.runId);
    const terminal = await waitForTerminal(started.runId);

    expect(terminal.status).toBe("cancelled");
    expect(terminal.result?.error).toBe("Evaluation was cancelled");
    expect(await readdir(cacheRoot)).toEqual([]);
  });

  it("cancels the local clone while an evaluation is still preparing", async () => {
    const processRunner: EvaluationProcessRunner = {
      isolationAvailability: () => ({ available: true }),
      run: vi.fn(),
      cancelActive: vi.fn(),
      dispose: vi.fn()
    };
    const { project, cacheRoot } = await setup(processRunner);
    const delegate = git!;
    let announceCloneStarted: (() => void) | undefined;
    const cloneStarted = new Promise<void>((resolve) => {
      announceCloneStarted = resolve;
    });
    git = {
      run: (args, options) => {
        if (!args.includes("clone")) return delegate.run(args, options);
        announceCloneStarted?.();
        return new Promise((_, reject) => {
          const abort = () => reject(new Error("Git command was cancelled"));
          options?.signal?.addEventListener("abort", abort, { once: true });
          if (options?.signal?.aborted) abort();
        });
      },
      cancelActive: () => delegate.cancelActive(),
      dispose: () => delegate.dispose()
    };
    const preview = await service!.preview({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: project
    });
    const started = await service!.start({ previewId: preview.previewId, prompt: "Wait" });
    await cloneStarted;

    await service!.cancel(started.runId);
    const terminal = await waitForTerminal(started.runId);

    expect(terminal.status).toBe("cancelled");
    expect(processRunner.run).not.toHaveBeenCalled();
    expect(await readdir(cacheRoot)).toEqual([]);
  });
});
