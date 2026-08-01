import { createHash, randomUUID } from "node:crypto";
import type {
  OneShotEvaluationPreview,
  OneShotEvaluationPreviewInput,
  OneShotEvaluationReadInput,
  OneShotEvaluationResult,
  OneShotEvaluationRun,
  OneShotEvaluationStartInput,
  OneShotEvaluationUsage
} from "../../shared/evaluations";
import { oneShotEvaluationIsActive } from "../../shared/evaluations";
import { profileResourceMode } from "../../shared/profileResources";
import type { ProfileDetail, SkillLibraryEntry, TargetPaths } from "../../shared/types";
import { createProfileContentHash } from "../profileFingerprint";
import type { ProfileStore } from "../profileStore";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";
import type { TargetDiscoveryService } from "../targetDiscovery";
import type { TargetRegistry } from "../targets/registry";
import { hashPathEntry } from "../filesystemIntegrity";
import { redactSensitiveValues } from "../secretWarnings";
import {
  EvaluationProcessError,
  type EvaluationProcessRunner
} from "./evaluationProcessRunner";
import type { EvaluationResultStore } from "./evaluationResultStore";
import {
  createEvaluationWorkspace,
  type EvaluationProjectSnapshot,
  type EvaluationWorkspace,
  type PreparedEvaluationWorkspace
} from "./evaluationWorkspace";

interface StoredPreview {
  value: OneShotEvaluationPreview;
  profileHash: string;
  skillFingerprint: string;
  targetFingerprint: string;
  project: EvaluationProjectSnapshot;
  sourceTargetPaths: TargetPaths;
  executablePath: string;
  excludeMcp: boolean;
  createdAtMs: number;
}

interface ActiveRun {
  value: OneShotEvaluationRun;
  controller: AbortController;
  workspace?: PreparedEvaluationWorkspace;
}

export interface EvaluationService {
  preview(input: OneShotEvaluationPreviewInput): Promise<OneShotEvaluationPreview>;
  start(input: OneShotEvaluationStartInput): Promise<OneShotEvaluationRun>;
  read(input?: OneShotEvaluationReadInput): Promise<OneShotEvaluationRun | undefined>;
  cancel(runId: string): Promise<OneShotEvaluationRun>;
  dispose(): void;
}

export interface EvaluationServiceOptions {
  cacheRoot: string;
  homeDir: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  profileStore: ProfileStore;
  skillLibraryStore: Pick<SkillLibraryStore, "listSkills">;
  targetRegistry: TargetRegistry;
  targetDiscoveryService: TargetDiscoveryService;
  processRunner: EvaluationProcessRunner;
  resultStore: EvaluationResultStore;
  loadGitRunner(): Promise<GitCommandRunner>;
}

const PREVIEW_TTL_MS = 10 * 60 * 1_000;
const MAX_PROMPT_LENGTH = 64 * 1024;

const targetHashFor = (profile: ProfileDetail, targetId: string) =>
  profile.targetContentHashes?.[targetId] ?? createProfileContentHash(profile, targetId);

const skillFingerprint = (profile: ProfileDetail, skills: SkillLibraryEntry[]) => {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const values = profile.resources.skills.map((reference) => {
    const skill = byId.get(reference.libraryId);
    return {
      ...reference,
      contentHash: skill?.contentHash ?? null,
      globallyEnabled: skill?.globallyEnabled ?? false
    };
  });
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
};

const protectedTargetPaths = (paths: TargetPaths) => [...new Set([
  paths.instructionsPath,
  paths.instructionsOverridePath,
  paths.configPath,
  paths.mcpConfigPath,
  ...(paths.skillLocations ?? []).map((location) => location.path)
].filter((path): path is string => Boolean(path)))];

const targetFingerprint = async (paths: TargetPaths) => {
  const entries = await Promise.all(protectedTargetPaths(paths).map(async (path) => ({
    path,
    hash: await hashPathEntry(path)
  })));
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
};

const addUsage = (
  current: OneShotEvaluationUsage,
  next: OneShotEvaluationUsage
) => {
  const sum = (left?: number, right?: number) =>
    left === undefined && right === undefined ? undefined : (left ?? 0) + (right ?? 0);
  return {
    inputTokens: sum(current.inputTokens, next.inputTokens),
    cachedInputTokens: sum(current.cachedInputTokens, next.cachedInputTokens),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    reasoningTokens: sum(current.reasoningTokens, next.reasoningTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens),
    reportedCostUsd: sum(current.reportedCostUsd, next.reportedCostUsd)
  };
};

const inferredStoredStatus = (result: OneShotEvaluationResult): OneShotEvaluationRun["status"] =>
  result.error === "Evaluation was cancelled"
    ? "cancelled"
    : result.error
      ? "failed-to-run"
      : "completed";

export const createEvaluationService = (
  options: EvaluationServiceOptions
): EvaluationService => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const previews = new Map<string, StoredPreview>();
  let activeRun: ActiveRun | undefined;
  let workspace: EvaluationWorkspace | undefined;
  let workspacePromise: Promise<EvaluationWorkspace> | undefined;
  let startInProgress = false;
  let disposed = false;

  const getWorkspace = async () => {
    if (workspace) return workspace;
    workspacePromise ??= options.loadGitRunner()
      .then(async (git) => {
        const created = createEvaluationWorkspace({
          cacheRoot: options.cacheRoot,
          git,
          platform
        });
        await created.cleanupStale();
        workspace = created;
        return created;
      })
      .catch((error) => {
        workspacePromise = undefined;
        throw error;
      });
    return workspacePromise;
  };

  const cleanupPreviews = () => {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, preview] of previews) {
      if (preview.createdAtMs < cutoff) previews.delete(id);
    }
  };

  const preview = async (
    input: OneShotEvaluationPreviewInput
  ): Promise<OneShotEvaluationPreview> => {
    if (disposed) throw new Error("Evaluation service is shutting down");
    cleanupPreviews();
    const isolation = options.processRunner.isolationAvailability();
    if (!isolation.available) throw new Error(isolation.reason ?? "Evaluation isolation is unavailable");
    const adapter = options.targetRegistry.get(input.targetId);
    if (!adapter.evaluations || !adapter.descriptor.capabilities.evaluation) {
      throw new Error(`${adapter.descriptor.name} does not support one-shot evaluation yet`);
    }
    const [profile, librarySkills, targets, project] = await Promise.all([
      options.profileStore.readProfile(input.profileId),
      options.skillLibraryStore.listSkills(),
      options.targetDiscoveryService.listTargets(),
      getWorkspace().then((service) => service.inspectProject(input.projectPath))
    ]);
    const target = targets.find((candidate) => candidate.id === input.targetId);
    if (!target?.health.executablePath) {
      throw new Error(`${adapter.descriptor.name} command was not found`);
    }
    const excludeMcp = true;
    const availability = await adapter.evaluations.checkAvailability({
      profile,
      targetPaths: target.paths,
      sourceHomeDir: options.homeDir,
      executablePath: target.health.executablePath,
      excludeMcp,
      platform,
      environment
    });
    if (!availability.available) {
      throw new Error(availability.reason ?? `${adapter.descriptor.name} evaluation is unavailable`);
    }

    const instructionsMode = profileResourceMode(profile.resources, input.targetId, "instructions");
    const skillsMode = profileResourceMode(profile.resources, input.targetId, "skills");
    const mcpMode = profileResourceMode(profile.resources, input.targetId, "mcp");
    const instructionsIncluded = instructionsMode === "manage"
      ? Number(Boolean(profile.instructions))
      : instructionsMode === "ignore"
        ? Number(Boolean(await hashPathEntry(target.paths.instructionsPath)))
        : 0;
    let skillsIncluded = 0;
    let skillsOmitted = 0;
    if (skillsMode === "manage") {
      const libraryById = new Map(librarySkills.map((skill) => [skill.id, skill]));
      for (const reference of profile.resources.skills) {
        const skill = libraryById.get(reference.libraryId);
        if (reference.enabled && !skill) {
          throw new Error(`Profile Skill ${reference.targetName} is missing from Library`);
        }
        if (reference.enabled && skill?.globallyEnabled) {
          skillsIncluded += 1;
        } else {
          skillsOmitted += 1;
        }
      }
    } else if (skillsMode === "ignore") {
      const runtime = await adapter.skills.inspectRuntime(target.paths);
      skillsIncluded = runtime.observations.filter(
        (observation) => observation.availability === "enabled"
      ).length;
      skillsOmitted = runtime.observations.length - skillsIncluded;
    } else {
      skillsOmitted = profile.resources.skills.length;
    }

    const warnings = [
      ...(project.hasUncommittedChanges
        ? ["Uncommitted project changes are excluded; evaluation uses the current HEAD commit"]
        : []),
      ...availability.warnings
    ];
    const value: OneShotEvaluationPreview = {
      previewId: randomUUID(),
      profileId: profile.id,
      profileName: profile.manifest.name,
      profileContentHash: targetHashFor(profile, input.targetId),
      targetId: input.targetId,
      targetName: adapter.descriptor.name,
      cliVersion: availability.cliVersion,
      projectPath: project.projectPath,
      projectRevision: project.revision,
      projectHasUncommittedChanges: project.hasUncommittedChanges,
      resources: {
        instructions: {
          mode: instructionsMode,
          includedCount: instructionsIncluded
        },
        skills: {
          mode: skillsMode,
          includedCount: skillsIncluded,
          omittedCount: skillsOmitted
        },
        mcp: {
          mode: mcpMode,
          includedCount: availability.mcpIncludedCount,
          omittedCount: availability.mcpOmittedCount
        }
      },
      fidelity: availability.fidelity,
      requiresMcpExclusion: availability.requiresMcpExclusion,
      warnings: [...new Set(warnings)],
      createdAt: new Date().toISOString()
    };
    previews.set(value.previewId, {
      value,
      profileHash: value.profileContentHash,
      skillFingerprint: skillFingerprint(profile, librarySkills),
      targetFingerprint: await targetFingerprint(target.paths),
      project,
      sourceTargetPaths: target.paths,
      executablePath: target.health.executablePath,
      excludeMcp,
      createdAtMs: Date.now()
    });
    return value;
  };

  const setRun = (patch: Partial<OneShotEvaluationRun>) => {
    if (!activeRun) return;
    activeRun.value = { ...activeRun.value, ...patch };
  };

  const execute = async (
    run: ActiveRun,
    storedPreview: StoredPreview,
    prompt: string
  ) => {
    const adapter = options.targetRegistry.get(storedPreview.value.targetId);
    const evaluationCapability = adapter.evaluations!;
    const started = Date.parse(run.value.startedAt);
    const responses: string[] = [];
    const eventErrors: string[] = [];
    let usage: OneShotEvaluationUsage = {};
    let model: string | undefined;
    let processExitCode: number | undefined;
    let terminalError: string | undefined;
    let terminalStatus: OneShotEvaluationRun["status"] = "failed-to-run";
    let changes = { diff: "", fileDiffs: [], changedFiles: [] } as Awaited<ReturnType<EvaluationWorkspace["readChanges"]>>;
    let launchWarnings: string[] = [];
    let cliVersion = storedPreview.value.cliVersion;
    let fidelity = storedPreview.value.fidelity;

    try {
      setRun({ stage: "Creating isolated project snapshot" });
      const [profile, librarySkills] = await Promise.all([
        options.profileStore.readProfile(storedPreview.value.profileId),
        options.skillLibraryStore.listSkills()
      ]);
      if (targetHashFor(profile, storedPreview.value.targetId) !== storedPreview.profileHash) {
        throw new Error("Profile changed after evaluation preview. Review it again.");
      }
      if (skillFingerprint(profile, librarySkills) !== storedPreview.skillFingerprint) {
        throw new Error("Profile Skills changed after evaluation preview. Review it again.");
      }
      const prepared = await (await getWorkspace()).prepare({
        adapter,
        profile,
        librarySkills,
        project: storedPreview.project,
        sourceTargetPaths: storedPreview.sourceTargetPaths,
        platform,
        signal: run.controller.signal
      });
      run.workspace = prepared;
      if (run.controller.signal.aborted) {
        throw new EvaluationProcessError("cancelled", "Evaluation was cancelled");
      }
      setRun({ stage: "Materializing Profile resources" });
      const launchSpec = await evaluationCapability.createLaunchSpec({
        profile,
        targetPaths: storedPreview.sourceTargetPaths,
        sourceHomeDir: options.homeDir,
        executablePath: storedPreview.executablePath,
        knownCliVersion: storedPreview.value.cliVersion,
        excludeMcp: storedPreview.excludeMcp,
        platform,
        environment,
        evaluationHome: prepared.home,
        evaluationProject: prepared.project,
        evaluationTargetPaths: prepared.resources.targetPaths,
        evaluationTempDir: prepared.temp,
        prompt
      });
      launchWarnings = launchSpec.warnings;
      cliVersion = launchSpec.cliVersion ?? cliVersion;
      fidelity = launchSpec.fidelity;
      setRun({ stage: "Verifying immutable inputs" });
      const [latestProfile, latestSkills, latestProject, latestTargetFingerprint] = await Promise.all([
        options.profileStore.readProfile(storedPreview.value.profileId),
        options.skillLibraryStore.listSkills(),
        (await getWorkspace()).inspectProject(storedPreview.value.projectPath),
        targetFingerprint(storedPreview.sourceTargetPaths)
      ]);
      if (targetHashFor(latestProfile, storedPreview.value.targetId) !== storedPreview.profileHash) {
        throw new Error("Profile changed while the evaluation was prepared. Review it again.");
      }
      if (skillFingerprint(latestProfile, latestSkills) !== storedPreview.skillFingerprint) {
        throw new Error("Profile Skills changed while the evaluation was prepared. Review it again.");
      }
      if (
        latestProject.revision !== storedPreview.project.revision ||
        latestProject.worktreeFingerprint !== storedPreview.project.worktreeFingerprint
      ) {
        throw new Error("Project changed while the evaluation was prepared. Review it again.");
      }
      if (latestTargetFingerprint !== storedPreview.targetFingerprint) {
        throw new Error("Agent resources changed while the evaluation was prepared. Review it again.");
      }
      setRun({ status: "running", stage: "Running", canCancel: true });
      const processResult = await options.processRunner.run(
        launchSpec,
        evaluationCapability.parseEvent,
        {
          signal: run.controller.signal,
          onEvent: (event) => {
            if (event.type === "response") responses.push(event.text);
            else if (event.type === "usage") {
              usage = addUsage(usage, event.usage);
              model = event.model ?? model;
            } else if (event.type === "error") {
              eventErrors.push(event.message);
            }
          }
        }
      );
      processExitCode = processResult.exitCode;
      setRun({ stage: "Collecting response and file changes", canCancel: false });
      changes = await (await getWorkspace()).readChanges(prepared);
      await (await getWorkspace()).verifyOriginals(prepared);
      if (processResult.exitCode !== 0 || eventErrors.length > 0) {
        terminalError = eventErrors[0] || processResult.stderr ||
          `${adapter.descriptor.name} exited with code ${processResult.exitCode}`;
        terminalStatus = "failed-to-run";
      } else {
        terminalStatus = "completed";
      }
    } catch (error) {
      if (
        run.controller.signal.aborted ||
        (error instanceof EvaluationProcessError && error.reason === "cancelled")
      ) {
        terminalStatus = "cancelled";
        terminalError = "Evaluation was cancelled";
      } else {
        terminalStatus = "failed-to-run";
        terminalError = error instanceof Error ? error.message : String(error);
      }
      if (run.workspace) {
        try {
          changes = await (await getWorkspace()).readChanges(run.workspace);
          await (await getWorkspace()).verifyOriginals(run.workspace);
        } catch (verificationError) {
          terminalError = `${terminalError ?? "Evaluation failed"}. ${
            verificationError instanceof Error ? verificationError.message : String(verificationError)
          }`;
        }
      }
    }

    if (run.workspace) {
      setRun({ stage: "Removing temporary evaluation workspace", canCancel: false });
      try {
        await (await getWorkspace()).cleanup(run.workspace);
      } catch (cleanupError) {
        terminalStatus = "failed-to-run";
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        terminalError = terminalError
          ? `${terminalError}. Temporary workspace cleanup failed: ${message}`
          : `Temporary workspace cleanup failed: ${message}`;
      }
    }

    const completedAt = new Date().toISOString();
    const result: OneShotEvaluationResult = {
      runId: run.value.runId,
      profileId: storedPreview.value.profileId,
      profileName: storedPreview.value.profileName,
      profileContentHash: storedPreview.value.profileContentHash,
      skillContentHashes: run.workspace?.resources.skillContentHashes ?? {},
      targetId: storedPreview.value.targetId,
      targetName: storedPreview.value.targetName,
      projectPath: storedPreview.value.projectPath,
      projectRevision: storedPreview.value.projectRevision,
      cliVersion,
      model,
      prompt,
      startedAt: run.value.startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - started),
      exitCode: processExitCode,
      finalResponse: responses.join(""),
      diff: changes.diff,
      fileDiffs: changes.fileDiffs,
      changedFiles: changes.changedFiles,
      usage: Object.values(usage).some((value) => value !== undefined) ? usage : undefined,
      fidelity,
      warnings: [...new Set([
        ...storedPreview.value.warnings,
        ...(run.workspace?.resources.warnings ?? []),
        ...launchWarnings
      ])],
      ...(terminalError ? { error: redactSensitiveValues(terminalError) } : {})
    };
    try {
      const stored = await options.resultStore.saveLatest(result, {
        privatePaths: run.workspace
          ? [run.workspace.root, run.workspace.home, run.workspace.project, run.workspace.temp]
          : []
      });
      setRun({
        status: terminalStatus,
        stage: terminalStatus === "completed"
          ? "Evaluation completed"
          : terminalStatus === "cancelled"
            ? "Evaluation cancelled"
            : "Evaluation failed to run",
        canCancel: false,
        result: stored,
        error: stored.error
      });
    } catch (storeError) {
      setRun({
        status: "failed-to-run",
        stage: "Evaluation report could not be saved",
        canCancel: false,
        error: storeError instanceof Error ? storeError.message : String(storeError)
      });
    }
  };

  const start = async (input: OneShotEvaluationStartInput): Promise<OneShotEvaluationRun> => {
    if (disposed) throw new Error("Evaluation service is shutting down");
    if (startInProgress || (activeRun && oneShotEvaluationIsActive(activeRun.value.status))) {
      throw new Error("Another evaluation is already running");
    }
    startInProgress = true;
    try {
      const storedPreview = previews.get(input.previewId);
      if (!storedPreview || Date.now() - storedPreview.createdAtMs > PREVIEW_TTL_MS) {
        throw new Error("Evaluation preview expired. Review the project and Profile again.");
      }
      if (storedPreview.value.requiresMcpExclusion) {
        throw new Error("Exclude unsafe or unavailable MCP settings before running this evaluation");
      }
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error("Enter a task for this evaluation");
      if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("Evaluation task is too long");
      const [profile, librarySkills, currentProject, currentTargetFingerprint] = await Promise.all([
        options.profileStore.readProfile(storedPreview.value.profileId),
        options.skillLibraryStore.listSkills(),
        (await getWorkspace()).inspectProject(storedPreview.value.projectPath),
        targetFingerprint(storedPreview.sourceTargetPaths)
      ]);
      if (targetHashFor(profile, storedPreview.value.targetId) !== storedPreview.profileHash) {
        throw new Error("Profile changed after evaluation preview. Review it again.");
      }
      if (skillFingerprint(profile, librarySkills) !== storedPreview.skillFingerprint) {
        throw new Error("Profile Skills changed after evaluation preview. Review it again.");
      }
      if (
        currentProject.revision !== storedPreview.project.revision ||
        currentProject.worktreeFingerprint !== storedPreview.project.worktreeFingerprint
      ) {
        throw new Error("Project changed after evaluation preview. Review it again.");
      }
      if (currentTargetFingerprint !== storedPreview.targetFingerprint) {
        throw new Error("Agent resources changed after evaluation preview. Review it again.");
      }
      if (disposed) throw new Error("Evaluation service is shutting down");

      const value: OneShotEvaluationRun = {
        runId: randomUUID(),
        profileId: storedPreview.value.profileId,
        profileName: storedPreview.value.profileName,
        targetId: storedPreview.value.targetId,
        targetName: storedPreview.value.targetName,
        projectPath: storedPreview.value.projectPath,
        projectRevision: storedPreview.value.projectRevision,
        status: "preparing",
        stage: "Preparing isolated evaluation",
        startedAt: new Date().toISOString(),
        canCancel: true
      };
      activeRun = { value, controller: new AbortController() };
      void execute(activeRun, storedPreview, prompt);
      return { ...value };
    } finally {
      startInProgress = false;
    }
  };

  const read = async (
    input: OneShotEvaluationReadInput = {}
  ): Promise<OneShotEvaluationRun | undefined> => {
    if (activeRun && (!input.runId || activeRun.value.runId === input.runId)) {
      return { ...activeRun.value };
    }
    const result = await options.resultStore.readLatest();
    if (!result || (input.runId && result.runId !== input.runId)) return undefined;
    const status = inferredStoredStatus(result);
    return {
      runId: result.runId,
      profileId: result.profileId,
      profileName: result.profileName,
      targetId: result.targetId,
      targetName: result.targetName,
      projectPath: result.projectPath,
      projectRevision: result.projectRevision,
      status,
      stage: status === "completed"
        ? "Evaluation completed"
        : status === "cancelled"
          ? "Evaluation cancelled"
          : "Evaluation failed to run",
      startedAt: result.startedAt,
      canCancel: false,
      result,
      error: result.error
    };
  };

  const cancel = async (runId: string): Promise<OneShotEvaluationRun> => {
    if (!activeRun || activeRun.value.runId !== runId) {
      throw new Error("Evaluation run was not found");
    }
    if (!oneShotEvaluationIsActive(activeRun.value.status)) return { ...activeRun.value };
    setRun({ status: "cancelling", stage: "Cancelling evaluation", canCancel: false });
    activeRun.controller.abort();
    options.processRunner.cancelActive();
    return { ...activeRun.value };
  };

  return {
    preview,
    start,
    read,
    cancel,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      activeRun?.controller.abort();
      options.processRunner.dispose();
    }
  };
};
