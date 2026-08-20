import { createHash, randomUUID } from "node:crypto";
import type {
  OneShotEvaluationDelta,
  OneShotEvaluationFidelity,
  OneShotEvaluationPreview,
  OneShotEvaluationPreviewInput,
  OneShotEvaluationReadInput,
  OneShotEvaluationResourceScope,
  OneShotEvaluationResult,
  OneShotEvaluationRun,
  OneShotEvaluationSideResult,
  OneShotEvaluationStartInput,
  OneShotEvaluationUsage,
  OneShotEvaluationWorkspaceInput
} from "../../shared/evaluations";
import { oneShotEvaluationIsActive } from "../../shared/evaluations";
import { profileResourceMode } from "../../shared/profileResources";
import { profileEffectiveInstructions } from "../../shared/profileInstructions";
import type { ProfileDetail, SkillLibraryEntry, TargetPaths } from "../../shared/types";
import { createProfileContentHash } from "../profileFingerprint";
import type { ProfileStore } from "../profileStore";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { GitCommandRunner } from "../skillSources/gitCommandRunner";
import type { TargetDiscoveryService } from "../targetDiscovery";
import type { TargetRegistry } from "../targets/registry";
import type { AgentTargetAdapter, EvaluationAvailability } from "../targets/types";
import { hashPathEntry } from "../filesystemIntegrity";
import { redactSensitiveValues } from "../secretWarnings";
import {
  EvaluationProcessError,
  type EvaluationProcessRunner
} from "./evaluationProcessRunner";
import type { EvaluationResultStore } from "./evaluationResultStore";
import {
  createEvaluationWorkspace,
  type EvaluationWorkspace,
  type EvaluationWorkspaceChanges,
  type EvaluationWorkspaceSnapshot,
  type PreparedEvaluationWorkspace
} from "./evaluationWorkspace";

interface StoredPreview {
  value: OneShotEvaluationPreview;
  profileHash: string;
  skillFingerprint: string;
  targetFingerprint: string;
  workspace: EvaluationWorkspaceSnapshot;
  sourceTargetPaths: TargetPaths;
  executablePath: string;
  excludeMcp: boolean;
  createdAtMs: number;
}

interface ActiveRun {
  value: OneShotEvaluationRun;
  controller: AbortController;
  workspaces: PreparedEvaluationWorkspace[];
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
  loadGitRunner?(): Promise<GitCommandRunner | undefined>;
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

const currentEnvironmentProfile = (profile: ProfileDetail, targetId: string): ProfileDetail => ({
  ...profile,
  resources: {
    ...profile.resources,
    managementByTarget: {
      ...(profile.resources.managementByTarget ?? {}),
      [targetId]: { instructions: "ignore", skills: "ignore" }
    },
    mcpByTarget: {
      ...profile.resources.mcpByTarget,
      [targetId]: { mode: "ignore", selections: [] }
    }
  }
});

const emptyChanges = (): EvaluationWorkspaceChanges => ({
  diff: "",
  fileDiffs: [],
  changedFiles: []
});

const emptySideResult = (
  environment: "current" | "proposed",
  startedAt: string,
  error: string,
  fidelity: OneShotEvaluationFidelity
): OneShotEvaluationSideResult => ({
  environment,
  environmentContentHash: "",
  skillContentHashes: {},
  startedAt,
  completedAt: new Date().toISOString(),
  durationMs: 0,
  finalResponse: "",
  diff: "",
  fileDiffs: [],
  changedFiles: [],
  fidelity,
  warnings: [],
  error: redactSensitiveValues(error)
});

const inferredStoredStatus = (result: OneShotEvaluationResult): OneShotEvaluationRun["status"] => {
  if (result.error === "Comparison was cancelled") return "cancelled";
  if (result.error) return "failed-to-run";
  if (result.current.error || result.proposed.error) return "incomplete";
  return "completed";
};

const worstFidelity = (
  ...values: OneShotEvaluationFidelity[]
): OneShotEvaluationFidelity => values.every((value) => value === "full") ? "full" : "partial";

export const createEvaluationService = (
  options: EvaluationServiceOptions
): EvaluationService => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const previews = new Map<string, StoredPreview>();
  let activeRun: ActiveRun | undefined;
  let startInProgress = false;
  let disposed = false;
  const workspace = createEvaluationWorkspace({
    cacheRoot: options.cacheRoot,
    loadGitRunner: options.loadGitRunner,
    platform
  });
  let workspaceReady = false;

  const getWorkspace = async () => {
    if (!workspaceReady) {
      await workspace.cleanupStale();
      workspaceReady = true;
    }
    return workspace;
  };

  const cleanupPreviews = () => {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, preview] of previews) {
      if (preview.createdAtMs < cutoff) previews.delete(id);
    }
  };

  const summarizeResources = async (
    profile: ProfileDetail,
    adapter: AgentTargetAdapter,
    targetPaths: TargetPaths,
    librarySkills: SkillLibraryEntry[],
    availability: EvaluationAvailability
  ) => {
    const targetId = adapter.descriptor.id;
    const instructionsMode = profileResourceMode(profile.resources, targetId, "instructions");
    const skillsMode = profileResourceMode(profile.resources, targetId, "skills");
    const mcpMode = profileResourceMode(profile.resources, targetId, "mcp");
    const instructionsIncluded = instructionsMode === "manage"
      ? Number(Boolean(profileEffectiveInstructions(profile)))
      : instructionsMode === "ignore"
        ? Number(Boolean(await hashPathEntry(targetPaths.instructionsPath)))
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
        if (reference.enabled && skill?.globallyEnabled) skillsIncluded += 1;
        else skillsOmitted += 1;
      }
    } else if (skillsMode === "ignore") {
      const runtime = await adapter.skills.inspectRuntime(targetPaths);
      skillsIncluded = runtime.observations.filter(
        (observation) => observation.availability === "enabled"
      ).length;
      skillsOmitted = runtime.observations.length - skillsIncluded;
    } else {
      skillsOmitted = profile.resources.skills.length;
    }
    return {
      instructions: { mode: instructionsMode, includedCount: instructionsIncluded },
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
    } satisfies {
      instructions: OneShotEvaluationResourceScope;
      skills: OneShotEvaluationResourceScope;
      mcp: OneShotEvaluationResourceScope;
    };
  };

  const preview = async (
    input: OneShotEvaluationPreviewInput
  ): Promise<OneShotEvaluationPreview> => {
    if (disposed) throw new Error("Comparison service is shutting down");
    cleanupPreviews();
    const isolation = options.processRunner.isolationAvailability();
    if (!isolation.available) throw new Error(isolation.reason ?? "Comparison isolation is unavailable");
    const adapter = options.targetRegistry.get(input.targetId);
    if (!adapter.evaluations || !adapter.descriptor.capabilities.evaluation) {
      throw new Error(`${adapter.descriptor.name} does not support Profile comparison yet`);
    }
    const [profile, librarySkills, targets, workspaceSnapshot] = await Promise.all([
      options.profileStore.readProfile(input.profileId),
      options.skillLibraryStore.listSkills(),
      options.targetDiscoveryService.listTargets(),
      getWorkspace().then((service) => service.inspectWorkspace(input.workspace ?? { kind: "empty" }))
    ]);
    const target = targets.find((candidate) => candidate.id === input.targetId);
    if (!target?.health.executablePath) {
      throw new Error(`${adapter.descriptor.name} runtime was not found`);
    }
    const excludeMcp = true;
    const currentProfile = currentEnvironmentProfile(profile, input.targetId);
    const [currentAvailability, proposedAvailability] = await Promise.all([
      adapter.evaluations.checkAvailability({
        profile: currentProfile,
        targetPaths: target.paths,
        sourceHomeDir: options.homeDir,
        executablePath: target.health.executablePath,
        excludeMcp,
        platform,
        environment
      }),
      adapter.evaluations.checkAvailability({
        profile,
        targetPaths: target.paths,
        sourceHomeDir: options.homeDir,
        executablePath: target.health.executablePath,
        excludeMcp,
        platform,
        environment
      })
    ]);
    for (const availability of [currentAvailability, proposedAvailability]) {
      if (!availability.available) {
        throw new Error(availability.reason ?? `${adapter.descriptor.name} comparison is unavailable`);
      }
    }
    const [currentResources, proposedResources] = await Promise.all([
      summarizeResources(currentProfile, adapter, target.paths, librarySkills, currentAvailability),
      summarizeResources(profile, adapter, target.paths, librarySkills, proposedAvailability)
    ]);
    const fidelity = worstFidelity(currentAvailability.fidelity, proposedAvailability.fidelity);
    const warnings = [...new Set([
      ...workspaceSnapshot.warnings,
      ...currentAvailability.warnings,
      ...proposedAvailability.warnings
    ])];
    const value: OneShotEvaluationPreview = {
      previewId: randomUUID(),
      profileId: profile.id,
      profileName: profile.manifest.name,
      profileContentHash: targetHashFor(profile, input.targetId),
      targetId: input.targetId,
      targetName: adapter.descriptor.name,
      cliVersion: proposedAvailability.cliVersion ?? currentAvailability.cliVersion,
      workspace: workspaceSnapshot.summary,
      runsRequired: 2,
      baselineSource: "fresh-run",
      currentResources,
      proposedResources,
      fidelity,
      requiresMcpExclusion:
        currentAvailability.requiresMcpExclusion || proposedAvailability.requiresMcpExclusion,
      warnings,
      createdAt: new Date().toISOString()
    };
    previews.set(value.previewId, {
      value,
      profileHash: value.profileContentHash,
      skillFingerprint: skillFingerprint(profile, librarySkills),
      targetFingerprint: await targetFingerprint(target.paths),
      workspace: workspaceSnapshot,
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

  const verifyInputs = async (
    storedPreview: StoredPreview,
    profile: ProfileDetail,
    librarySkills: SkillLibraryEntry[]
  ) => {
    const [latestWorkspace, latestTargetFingerprint] = await Promise.all([
      (await getWorkspace()).inspectWorkspace(storedPreview.workspace.input),
      targetFingerprint(storedPreview.sourceTargetPaths)
    ]);
    if (targetHashFor(profile, storedPreview.value.targetId) !== storedPreview.profileHash) {
      throw new Error("Profile changed after comparison Preview. Review it again.");
    }
    if (skillFingerprint(profile, librarySkills) !== storedPreview.skillFingerprint) {
      throw new Error("Profile Skills changed after comparison Preview. Review it again.");
    }
    if (latestWorkspace.summary.contentHash !== storedPreview.workspace.summary.contentHash) {
      throw new Error("Workspace changed after comparison Preview. Review it again.");
    }
    if (latestTargetFingerprint !== storedPreview.targetFingerprint) {
      throw new Error("Agent resources changed after comparison Preview. Review it again.");
    }
  };

  const runSide = async (
    environment: "current" | "proposed",
    run: ActiveRun,
    storedPreview: StoredPreview,
    profile: ProfileDetail,
    prepared: PreparedEvaluationWorkspace,
    prompt: string
  ): Promise<OneShotEvaluationSideResult> => {
    const adapter = options.targetRegistry.get(storedPreview.value.targetId);
    const capability = adapter.evaluations!;
    const startedAt = new Date().toISOString();
    const responses: string[] = [];
    const eventErrors: string[] = [];
    let usage: OneShotEvaluationUsage = {};
    let model: string | undefined;
    let exitCode: number | undefined;
    let changes = emptyChanges();
    let launchWarnings: string[] = [];
    let cliVersion = storedPreview.value.cliVersion;
    let fidelity = storedPreview.value.fidelity;
    let error: string | undefined;
    try {
      const launchSpec = await capability.createLaunchSpec({
        profile,
        targetPaths: storedPreview.sourceTargetPaths,
        sourceHomeDir: options.homeDir,
        executablePath: storedPreview.executablePath,
        knownCliVersion: storedPreview.value.cliVersion,
        excludeMcp: storedPreview.excludeMcp,
        platform,
        environment: options.environment ?? process.env,
        evaluationHome: prepared.home,
        evaluationProject: prepared.project,
        evaluationTargetPaths: prepared.resources.targetPaths,
        evaluationTempDir: prepared.temp,
        prompt
      });
      launchWarnings = launchSpec.warnings;
      cliVersion = launchSpec.cliVersion ?? cliVersion;
      fidelity = launchSpec.fidelity;
      if (run.controller.signal.aborted) {
        throw new EvaluationProcessError("cancelled", "Comparison was cancelled");
      }
      setRun({
        status: "running",
        stage: environment === "current" ? "Running current setup" : "Running proposed Profile",
        canCancel: true
      });
      const processResult = await options.processRunner.run(
        {
          ...launchSpec,
          readDeniedRoots: [...new Set([
            ...(launchSpec.readDeniedRoots ?? []),
            options.homeDir,
            ...protectedTargetPaths(storedPreview.sourceTargetPaths),
            ...(storedPreview.workspace.input.kind === "folder"
              ? [storedPreview.workspace.input.path]
              : [])
          ])]
        },
        capability.parseEvent,
        {
          signal: run.controller.signal,
          onEvent: (event) => {
            if (event.type === "response") {
              responses.push(event.text);
              if (event.usage) usage = addUsage(usage, event.usage);
              model = event.model ?? model;
            } else if (event.type === "usage") {
              usage = addUsage(usage, event.usage);
              model = event.model ?? model;
            } else if (event.type === "error") eventErrors.push(event.message);
          }
        }
      );
      exitCode = processResult.exitCode;
      changes = await (await getWorkspace()).readChanges(prepared);
      await (await getWorkspace()).verifyOriginals(prepared);
      if (processResult.exitCode !== 0 || eventErrors.length > 0) {
        error = eventErrors[0] || processResult.stderr ||
          `${adapter.descriptor.name} exited with code ${processResult.exitCode}`;
      }
    } catch (runError) {
      if (
        run.controller.signal.aborted ||
        (runError instanceof EvaluationProcessError && runError.reason === "cancelled")
      ) {
        throw new EvaluationProcessError("cancelled", "Comparison was cancelled");
      }
      error = runError instanceof Error ? runError.message : String(runError);
      try {
        changes = await (await getWorkspace()).readChanges(prepared);
        await (await getWorkspace()).verifyOriginals(prepared);
      } catch (verificationError) {
        error = `${error}. ${verificationError instanceof Error
          ? verificationError.message
          : String(verificationError)}`;
      }
    }
    const completedAt = new Date().toISOString();
    return {
      environment,
      environmentContentHash: prepared.resources.environmentContentHash,
      skillContentHashes: prepared.resources.skillContentHashes,
      cliVersion,
      model,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
      exitCode,
      finalResponse: responses.join(""),
      ...changes,
      usage: Object.values(usage).some((value) => value !== undefined) ? usage : undefined,
      fidelity,
      warnings: [...new Set([
        ...prepared.resources.warnings,
        ...launchWarnings
      ])],
      ...(error ? { error: redactSensitiveValues(error) } : {})
    };
  };

  const execute = async (
    run: ActiveRun,
    storedPreview: StoredPreview,
    prompt: string
  ) => {
    const started = Date.parse(run.value.startedAt);
    let current = emptySideResult("current", run.value.startedAt, "Current setup was not run", storedPreview.value.fidelity);
    let proposed = emptySideResult("proposed", run.value.startedAt, "Proposed Profile was not run", storedPreview.value.fidelity);
    let delta: OneShotEvaluationDelta = emptyChanges();
    let terminalStatus: OneShotEvaluationRun["status"] = "failed-to-run";
    let terminalError: string | undefined;
    try {
      setRun({ stage: "Creating isolated Workspace snapshots" });
      const [profile, librarySkills] = await Promise.all([
        options.profileStore.readProfile(storedPreview.value.profileId),
        options.skillLibraryStore.listSkills()
      ]);
      await verifyInputs(storedPreview, profile, librarySkills);
      const currentProfile = currentEnvironmentProfile(profile, storedPreview.value.targetId);
      const currentWorkspace = await (await getWorkspace()).prepare({
        adapter: options.targetRegistry.get(storedPreview.value.targetId),
        profile: currentProfile,
        librarySkills,
        workspace: storedPreview.workspace,
        sourceTargetPaths: storedPreview.sourceTargetPaths,
        platform,
        signal: run.controller.signal
      });
      run.workspaces.push(currentWorkspace);
      const proposedWorkspace = await (await getWorkspace()).prepare({
        adapter: options.targetRegistry.get(storedPreview.value.targetId),
        profile,
        librarySkills,
        workspace: storedPreview.workspace,
        sourceTargetPaths: storedPreview.sourceTargetPaths,
        platform,
        signal: run.controller.signal
      });
      run.workspaces.push(proposedWorkspace);
      await verifyInputs(storedPreview, profile, librarySkills);
      current = await runSide(
        "current",
        run,
        storedPreview,
        currentProfile,
        currentWorkspace,
        prompt
      );
      await verifyInputs(storedPreview, profile, librarySkills);
      proposed = await runSide(
        "proposed",
        run,
        storedPreview,
        profile,
        proposedWorkspace,
        prompt
      );
      setRun({ stage: "Comparing results", canCancel: false });
      delta = await (await getWorkspace()).compareOutputs(currentWorkspace, proposedWorkspace);
      await Promise.all([
        (await getWorkspace()).verifyOriginals(currentWorkspace),
        (await getWorkspace()).verifyOriginals(proposedWorkspace)
      ]);
      terminalStatus = current.error || proposed.error ? "incomplete" : "completed";
    } catch (error) {
      if (
        run.controller.signal.aborted ||
        (error instanceof EvaluationProcessError && error.reason === "cancelled")
      ) {
        terminalStatus = "cancelled";
        terminalError = "Comparison was cancelled";
      } else {
        terminalStatus = "failed-to-run";
        terminalError = error instanceof Error ? error.message : String(error);
      }
    }

    setRun({ stage: "Removing temporary comparison workspaces", canCancel: false });
    const cleanupErrors: string[] = [];
    for (const prepared of run.workspaces) {
      try {
        await (await getWorkspace()).cleanup(prepared);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
      }
    }
    if (cleanupErrors.length > 0) {
      terminalStatus = "failed-to-run";
      terminalError = [terminalError, `Temporary workspace cleanup failed: ${cleanupErrors.join("; ")}`]
        .filter(Boolean)
        .join(". ");
    }

    const completedAt = new Date().toISOString();
    const comparisonSignature = createHash("sha256").update(JSON.stringify({
      profileHash: storedPreview.profileHash,
      targetFingerprint: storedPreview.targetFingerprint,
      workspaceHash: storedPreview.workspace.summary.contentHash,
      prompt,
      currentEnvironment: current.environmentContentHash,
      proposedEnvironment: proposed.environmentContentHash,
      currentCli: current.cliVersion ?? null,
      proposedCli: proposed.cliVersion ?? null
    })).digest("hex");
    const result: OneShotEvaluationResult = {
      runId: run.value.runId,
      profileId: storedPreview.value.profileId,
      profileName: storedPreview.value.profileName,
      profileContentHash: storedPreview.value.profileContentHash,
      skillContentHashes: proposed.skillContentHashes,
      targetId: storedPreview.value.targetId,
      targetName: storedPreview.value.targetName,
      workspace: storedPreview.value.workspace,
      prompt,
      startedAt: run.value.startedAt,
      completedAt,
      durationMs: Math.max(0, Date.parse(completedAt) - started),
      current,
      proposed,
      delta,
      baselineSource: "fresh-run",
      comparisonSignature,
      fidelity: worstFidelity(current.fidelity, proposed.fidelity),
      warnings: [...new Set([
        ...storedPreview.value.warnings,
        ...current.warnings,
        ...proposed.warnings
      ])],
      ...(terminalError ? { error: redactSensitiveValues(terminalError) } : {})
    };
    try {
      const privatePaths = run.workspaces.flatMap((prepared) => [
        prepared.root,
        prepared.home,
        prepared.baseline,
        prepared.project,
        prepared.temp
      ]);
      const stored = await options.resultStore.saveLatest(result, {
        privatePaths,
        pathRedactions: [
          ...protectedTargetPaths(storedPreview.sourceTargetPaths).map((path) => ({
            path,
            replacement: "<agent-resources>"
          })),
          { path: options.homeDir, replacement: "<home>" }
        ]
      });
      setRun({
        status: terminalStatus,
        stage: terminalStatus === "completed"
          ? "Comparison completed"
          : terminalStatus === "incomplete"
            ? "Comparison incomplete"
            : terminalStatus === "cancelled"
              ? "Comparison cancelled"
              : "Comparison failed to run",
        canCancel: false,
        result: stored,
        error: stored.error
      });
    } catch (storeError) {
      setRun({
        status: "failed-to-run",
        stage: "Comparison report could not be saved",
        canCancel: false,
        error: storeError instanceof Error ? storeError.message : String(storeError)
      });
    }
  };

  const start = async (input: OneShotEvaluationStartInput): Promise<OneShotEvaluationRun> => {
    if (disposed) throw new Error("Comparison service is shutting down");
    if (startInProgress || (activeRun && oneShotEvaluationIsActive(activeRun.value.status))) {
      throw new Error("Another comparison is already running");
    }
    startInProgress = true;
    try {
      const storedPreview = previews.get(input.previewId);
      if (!storedPreview || Date.now() - storedPreview.createdAtMs > PREVIEW_TTL_MS) {
        throw new Error("Comparison Preview expired. Review the Workspace and Profile again.");
      }
      if (storedPreview.value.requiresMcpExclusion) {
        throw new Error("Exclude unsafe or unavailable MCP settings before running this comparison");
      }
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error("Enter a task for this comparison");
      if (prompt.length > MAX_PROMPT_LENGTH) throw new Error("Comparison task is too long");
      const [profile, librarySkills] = await Promise.all([
        options.profileStore.readProfile(storedPreview.value.profileId),
        options.skillLibraryStore.listSkills()
      ]);
      await verifyInputs(storedPreview, profile, librarySkills);
      const value: OneShotEvaluationRun = {
        runId: randomUUID(),
        profileId: storedPreview.value.profileId,
        profileName: storedPreview.value.profileName,
        targetId: storedPreview.value.targetId,
        targetName: storedPreview.value.targetName,
        workspace: storedPreview.value.workspace,
        status: "preparing",
        stage: "Preparing isolated comparison",
        startedAt: new Date().toISOString(),
        canCancel: true
      };
      activeRun = { value, controller: new AbortController(), workspaces: [] };
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
      workspace: result.workspace,
      status,
      stage: status === "completed"
        ? "Comparison completed"
        : status === "incomplete"
          ? "Comparison incomplete"
          : status === "cancelled"
            ? "Comparison cancelled"
            : "Comparison failed to run",
      startedAt: result.startedAt,
      canCancel: false,
      result,
      error: result.error
    };
  };

  const cancel = async (runId: string): Promise<OneShotEvaluationRun> => {
    if (!activeRun || activeRun.value.runId !== runId) {
      throw new Error("Comparison run was not found");
    }
    if (!oneShotEvaluationIsActive(activeRun.value.status)) return { ...activeRun.value };
    const activeStage = activeRun.value.stage.toLowerCase();
    setRun({
      status: "cancelling",
      stage: activeStage.includes("current")
        ? "Cancelling current setup"
        : activeStage.includes("proposed")
          ? "Cancelling proposed Profile"
          : "Cancelling comparison",
      canCancel: false
    });
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
