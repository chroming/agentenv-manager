import { ipcMain } from "electron";
import { basename, dirname, join, resolve } from "node:path";
import type { ActivationService } from "./activationService";
import type { BackupMaintenanceService } from "./backupMaintenanceService";
import type { BackupStore } from "./backupStore";
import type { GitHubAuthService } from "./githubAuthService";
import type { ProfileStore } from "./profileStore";
import type { ProjectStore } from "./projects/projectStore";
import type { ProjectEnvironmentService } from "./projects/projectEnvironmentService";
import type { ProjectLaunchService } from "./projects/projectLaunchService";
import type { ProjectMutationService } from "./projects/projectMutationService";
import type { ProjectRecoveryStore } from "./projects/projectRecoveryStore";
import type { SettingsStore } from "./settingsStore";
import type { WorkspaceSyncService } from "./workspaceSync/workspaceSyncService";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { SkillMutationRecoveryGate } from "./skillMutationRecoveryGate";
import type { TargetDiscoveryService } from "./targetDiscovery";
import type { TargetCaptureService } from "./targetCaptureService";
import type { EvaluationService } from "./evaluations/evaluationService";
import {
  ResourceIconKeySchema,
  SafeIdSchema
} from "../shared/schemas";
import type {
  GitHubSkillImportInput,
  RepositorySkillImportInput,
  RepositorySkillSourceInput,
  ManageTargetSkillInput,
  RetireSharedSkillInput,
  SkillCleanupRequest,
  SkillImportInput,
  SkillImportPreviewInput,
  SkillIconInput,
  SkillMergeInput,
  SkillCollectionMemberDecisionUpdate,
  SkillSourceMergePreviewInput,
  SkillUpdateSettingsInput,
  SkillUpdateConfirmation,
  SkillAvailabilityInput,
  UnmanagedSkillLocationUpdate,
  TargetPaths
} from "../shared/types";
import type { TargetRegistry } from "./targets/registry";
import type { AgentEnvPaths } from "./paths";
import { isTargetInstalled } from "../shared/targetHealth";
import { isSkillCollectionItemLibraryReady } from "../shared/skillCleanup";
import type { MutationCoordinator } from "./mutationCoordinator";
import { readAllProfilesForResourceMutation } from "./profileSafety";
import { pathEntryExists } from "./fileUtils";
import { createSkillFileBrowser } from "./skillFileBrowser";
import type { ConversationService } from "./conversations/conversationService";
import {
  assertSharedSkillCleanupAuthority,
  materializeSharedSkillLocations,
  resolveSharedSkillLocation
} from "./targets/sharedSkillLocations";
import type { RuntimeDiagnostics } from "./runtimeDiagnostics";
import type { AppUpdateService } from "./appUpdates/updateService";
import type { TelemetryService } from "./telemetry/telemetryService";
import { isPathInside, pathsEqual } from "./platformPaths";
import { registerProfileIpc } from "./ipc/profileIpc";
import { registerConversationIpc } from "./ipc/conversationIpc";
import { registerProjectIpc } from "./ipc/projectIpc";
import { registerRecoveryIpc } from "./ipc/recoveryIpc";
import { registerSettingsIpc } from "./ipc/settingsIpc";
import { registerTargetIpc } from "./ipc/targetIpc";
import { registerDialogIpc } from "./ipc/dialogIpc";
import { registerSharedSkillAreaIpc } from "./ipc/sharedSkillAreaIpc";

export interface IpcServices {
  profileStore: ProfileStore;
  projectStore: ProjectStore;
  projectEnvironmentService: ProjectEnvironmentService;
  projectLaunchService: ProjectLaunchService;
  projectMutationService: ProjectMutationService;
  projectRecoveryStore: ProjectRecoveryStore;
  activationService: ActivationService;
  backupStore: BackupStore;
  backupMaintenanceService: BackupMaintenanceService;
  githubAuthService: GitHubAuthService;
  settingsStore: SettingsStore;
  skillLibraryStore: SkillLibraryStore;
  skillMutationRecoveryGate: SkillMutationRecoveryGate;
  targetRegistry: TargetRegistry;
  targetDiscoveryService: TargetDiscoveryService;
  conversationService: ConversationService;
  targetCaptureService: TargetCaptureService;
  evaluationService: EvaluationService;
  mutationCoordinator: MutationCoordinator;
  paths: AgentEnvPaths;
  workspaceSyncService: WorkspaceSyncService;
  diagnostics: RuntimeDiagnostics;
  appUpdateService: AppUpdateService;
  telemetryService: TelemetryService;
  uiStateStore: import("./uiStateStore").UiStateStore;
  cancelRepositoryOperations(): void;
}

const parseId = (value: unknown, label: string): string => {
  const parsed = SafeIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed.data;
};

export const registerIpcHandlers = ({
  profileStore,
  projectStore,
  projectEnvironmentService,
  projectLaunchService,
  projectMutationService,
  projectRecoveryStore,
  activationService,
  backupStore,
  backupMaintenanceService,
  githubAuthService,
  settingsStore,
  skillLibraryStore,
  skillMutationRecoveryGate,
  targetRegistry,
  targetDiscoveryService,
  conversationService,
  targetCaptureService,
  evaluationService,
  mutationCoordinator,
  paths,
  workspaceSyncService,
  diagnostics,
  appUpdateService,
  telemetryService,
  uiStateStore,
  cancelRepositoryOperations
}: IpcServices) => {
  const skillFileBrowser = createSkillFileBrowser(paths, settingsStore);
  const diagnosticHandle = (
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
  ) => {
    ipcMain.handle(channel, (event, ...args) =>
      diagnostics.runIpcOperation(channel, args, () => handler(event, ...args))
    );
  };
  const handleMutation = (
    channel: string,
    handler: (event: any, ...args: any[]) => any
  ) => {
    diagnosticHandle(channel, (event, ...args) =>
      mutationCoordinator.runExclusive(channel, async () => {
        return skillMutationRecoveryGate.run(channel, async () => {
          const changesWorkspace = /^(skills|profiles|activation|targets|data|settings|workspace-sync):/.test(channel);
          if (
            changesWorkspace &&
            channel !== "workspace-sync:recover" &&
            await pathEntryExists(paths.workspaceSyncJournalPath)
          ) {
            throw new Error("Workspace recovery is required before changing Profiles, Library resources, or Agents");
          }
          return await handler(event, ...args);
        });
      })
    );
  };
  const handleWorkspaceSyncMutation = (
    channel: string,
    handler: (event: any, ...args: any[]) => any
  ) => {
    diagnosticHandle(channel, (event, ...args) => {
      workspaceSyncService.cancel();
      return mutationCoordinator.runExclusive(channel, async () => {
        return skillMutationRecoveryGate.run(channel, async () => {
          if (
            channel !== "workspace-sync:recover" &&
            await pathEntryExists(paths.workspaceSyncJournalPath)
          ) {
            throw new Error("Workspace recovery is required before changing Profiles, Library resources, or Agents");
          }
          return await handler(event, ...args);
        });
      });
    });
  };
  const agentsSkillsLocation = resolveSharedSkillLocation("agents-skills", {
    homeDir: paths.homeDir,
    pathOverride: paths.userSkillsDir
  });
  const agentsSkillsRoot = resolve(agentsSkillsLocation.path);
  const sharedSkillTargetPaths: TargetPaths = materializeSharedSkillLocations({
    targetId: "shared-compatibility",
    configDir: dirname(paths.userSkillsDir),
    instructionsPath: join(dirname(paths.userSkillsDir), "AGENTS.md"),
    configPath: join(dirname(paths.userSkillsDir), "config.json"),
    sharedSkillLocationIds: ["agents-skills"]
  }, {
    homeDir: paths.homeDir,
    pathOverrides: { "agents-skills": paths.userSkillsDir }
  });
  const inventoryPathsFor = (targets: Awaited<ReturnType<TargetDiscoveryService["listTargets"]>>) => {
    const targetPaths = targets.map((target) => target.paths);
    const includesSharedRoot = targetPaths.some((target) =>
      target.sharedSkillLocationIds?.includes("agents-skills") &&
      target.skillLocations?.some(
        (location) =>
          location.sharedLocationId === "agents-skills" &&
          resolve(location.path) === agentsSkillsRoot
      )
    );
    return includesSharedRoot ? targetPaths : [...targetPaths, sharedSkillTargetPaths];
  };
  const waitForAutomationBackgroundDelay = async () => {
    const automationBackgroundDelayMs =
      process.env.AGENTENV_AUTOMATION === "1"
        ? Math.max(0, Number(process.env.AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS ?? 0))
        : 0;
    if (!Number.isFinite(automationBackgroundDelayMs) || automationBackgroundDelayMs <= 0) {
      return;
    }
    const state = globalThis as typeof globalThis & {
      __agentEnvBackgroundOperations?: number;
    };
    state.__agentEnvBackgroundOperations = (state.__agentEnvBackgroundOperations ?? 0) + 1;
    try {
      await new Promise((resolve) => setTimeout(resolve, automationBackgroundDelayMs));
    } finally {
      state.__agentEnvBackgroundOperations = Math.max(
        0,
        (state.__agentEnvBackgroundOperations ?? 1) - 1
      );
    }
  };
  const resolveSharedSkillPaths = async (values: unknown) => {
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("At least one shared Skill path is required");
    }
    const targets = await targetDiscoveryService.listTargets();
    const sharedRoots = new Set([
      agentsSkillsRoot,
      ...targets.flatMap((target) =>
        (target.paths.skillLocations ?? [])
          .filter((location) => location.shared && location.role === "compatibility-runtime")
          .map((location) => resolve(location.path))
      )
    ]);
    return [...new Set(values.map((value) => resolve(String(value))))].map((path) => {
      const root = dirname(path);
      if (!sharedRoots.has(root) || !basename(path)) {
        throw new Error(`Skill path is not a shared compatibility location: ${path}`);
      }
      return path;
    });
  };

  registerConversationIpc(
    { diagnosticHandle },
    { conversationService }
  );
  registerDialogIpc(
    { diagnosticHandle },
    { targetRegistry }
  );
  registerProjectIpc(
    { diagnosticHandle, handleMutation },
    {
      projectEnvironmentService,
      projectLaunchService,
      projectMutationService,
      projectRecoveryStore,
      projectStore,
      targetDiscoveryService
    }
  );
  registerTargetIpc(
    { diagnosticHandle },
    { activationService, targetDiscoveryService, targetRegistry }
  );
  registerSharedSkillAreaIpc(
    { diagnosticHandle, handleMutation, handleWorkspaceSyncMutation },
    { skillLibraryStore, resolveSharedSkillPaths }
  );
  diagnosticHandle("skills:list-library", () => skillLibraryStore.listSkills());
  diagnosticHandle("skills:list-files", (_event, id: unknown) =>
    skillFileBrowser.list(parseId(id, "skill id"))
  );
  diagnosticHandle("skills:read-file", (_event, input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid Skill file selection");
    const candidate = input as { id?: unknown; path?: unknown };
    if (typeof candidate.path !== "string") throw new Error("Invalid Skill file path");
    return skillFileBrowser.read(parseId(candidate.id, "skill id"), candidate.path);
  });
  diagnosticHandle("skills:scan-inventory", async () => {
    await waitForAutomationBackgroundDelay();
    if (
      process.env.AGENTENV_AUTOMATION === "1" &&
      process.env.AGENTENV_AUTOMATION_SKILL_SCAN_FAILURE === "1"
    ) {
      throw new Error("Simulated local Skill inventory failure");
    }
    const targets = await targetDiscoveryService.listTargets();
    const inventory = await skillLibraryStore.scanInventory(inventoryPathsFor(targets));
    const installedTargetIds = new Set(
      targets.filter((target) => isTargetInstalled(target.health)).map((target) => target.id)
    );
    return inventory.map((item) => item.sharedLocation
      ? {
          ...item,
          foundIn: item.foundIn.filter((targetId) => installedTargetIds.has(targetId))
        }
      : item);
  });
  diagnosticHandle("skills:list-cleanup-backups", async () =>
    (await Promise.all([
      activationService.listSharedSkillMigrationBackups(),
      skillLibraryStore.listCleanupBackups()
    ]))
      .flat()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  );
  handleMutation(
    "skills:set-unmanaged-locations",
    (_event, input: UnmanagedSkillLocationUpdate) => {
      if (!input || !Array.isArray(input.items) || typeof input.unmanaged !== "boolean") {
        throw new Error("Leave unmanaged requires at least one Skill path");
      }
      for (const item of input.items) {
        if (
          !item ||
          typeof item.path !== "string" ||
          (item.coverage !== undefined &&
            item.coverage !== "exact" &&
            item.coverage !== "collection")
        ) {
          throw new Error("Invalid unmanaged Skill location");
        }
      }
      return skillLibraryStore.setUnmanagedSkillLocations(input);
    }
  );
  handleMutation(
    "skills:set-collection-decision",
    (_event, input: SkillCollectionMemberDecisionUpdate) => {
      if (
        !input ||
        typeof input.path !== "string" ||
        typeof input.useLibrary !== "boolean"
      ) {
        throw new Error("Invalid Skill collection decision");
      }
      return skillLibraryStore.setSkillCollectionDecision(input);
    }
  );
  diagnosticHandle("skills:scan-unmanaged", () =>
    targetDiscoveryService
      .listTargets()
      .then((targets) => skillLibraryStore.scanUnmanaged(inventoryPathsFor(targets)))
  );
  diagnosticHandle("skills:preview-import", (_event, input: SkillImportPreviewInput) => {
    if (
      !input ||
      (input.kind !== "local" && input.kind !== "github" && input.kind !== "repository")
    ) {
      throw new Error("Skill import preview requires a local or Repository source");
    }
    return skillLibraryStore.previewImport(input);
  });
  diagnosticHandle("skills:preview-merge", async (_event, id: unknown) => {
    const skillId = parseId(id, "skill id");
    const targets = await targetDiscoveryService.listTargets();
    return skillLibraryStore.previewMerge(
      skillId,
      targets.map((target) => target.paths)
    );
  });
  handleMutation("skills:merge-library", async (_event, input: SkillMergeInput) => {
    if (!input || typeof input !== "object") {
      throw new Error("Skill merge selection is required");
    }
    const targets = await targetDiscoveryService.listTargets();
    return skillLibraryStore.mergeSkills(
      input,
      targets.map((target) => target.paths)
    );
  });
  handleMutation("skills:import-library", async (_event, input: SkillImportInput) => {
    if (!input || typeof input !== "object" || typeof input.sourcePath !== "string") {
      throw new Error("Skill import requires a source path");
    }
    const sourcePath = resolve(input.sourcePath);
    const libraryId = SafeIdSchema.parse(input.id ?? basename(sourcePath));
    const targets = await targetDiscoveryService.listTargets();
    const inventory = await skillLibraryStore.scanInventory(
      inventoryPathsFor(targets)
    );
    const localInstall = inventory.find((item) => resolve(item.path) === sourcePath);

    if (localInstall?.status === "managed" && localInstall.libraryId) {
      const skill = (await skillLibraryStore.listSkills()).find(
        (item) => item.id === localInstall.libraryId
      );
      if (skill) {
        return { skill, managedLocations: [sourcePath], reused: true };
      }
    }

    const skill = await skillLibraryStore.importSkill({
      ...input,
      id: libraryId,
      sourcePath
    });
    return {
      skill,
      managedLocations: [],
      reused:
        input.conflictResolution?.action === "reuse" ||
        input.conflictResolution?.action === "keep-existing",
      sourceUpdated: input.conflictResolution?.action === "update-source"
    };
  });
  handleMutation("skills:import-github", (_event, input: GitHubSkillImportInput) =>
    skillLibraryStore.importGitHubSkill(input)
  );
  diagnosticHandle("skills:scan-github", (_event, url: unknown) =>
    skillLibraryStore.scanGitHubSkills(String(url))
  );
  handleMutation("skills:import-github-batch", (_event, inputs: GitHubSkillImportInput[]) =>
    skillLibraryStore.importGitHubSkills(Array.isArray(inputs) ? inputs : [])
  );
  diagnosticHandle("skills:scan-repository", (_event, input: RepositorySkillSourceInput) => {
    if (!input || typeof input !== "object" || typeof input.repository !== "string") {
      throw new Error("Repository scan requires a repository address");
    }
    return skillLibraryStore.scanRepositorySkills(input);
  });
  diagnosticHandle("skills:scan-local-source", (_event, rootPath: unknown) => {
    if (typeof rootPath !== "string" || !rootPath.trim()) {
      throw new Error("Local Skill source requires a folder");
    }
    return skillLibraryStore.scanLocalSkillSource(resolve(rootPath));
  });
  handleMutation("skills:import-repository", (_event, input: RepositorySkillImportInput) => {
    if (!input || typeof input !== "object" || typeof input.repository !== "string") {
      throw new Error("Repository import requires a repository address");
    }
    return skillLibraryStore.importRepositorySkill(input);
  });
  handleMutation(
    "skills:import-repository-batch",
    (_event, inputs: RepositorySkillImportInput[]) =>
      skillLibraryStore.importRepositorySkills(Array.isArray(inputs) ? inputs : [])
  );
  diagnosticHandle("skills:list-source-groups", () => skillLibraryStore.listSourceGroups());
  diagnosticHandle("skills:check-source-group", (_event, sourceId: unknown) =>
    skillLibraryStore.checkSourceGroup(String(sourceId))
  );
  diagnosticHandle("skills:check-monitored-source-groups", () =>
    skillLibraryStore.checkMonitoredSourceGroups()
  );
  handleMutation("skills:set-source-name", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Skill source name requires a source selection");
    }
    const candidate = input as { sourceId?: unknown; name?: unknown };
    if (typeof candidate.sourceId !== "string" ||
      (candidate.name !== undefined && typeof candidate.name !== "string")) {
      throw new Error("Skill source name is invalid");
    }
    return skillLibraryStore.setSourceName({
      sourceId: candidate.sourceId,
      name: candidate.name
    });
  });
  handleMutation("skills:set-source-monitored", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Skill source monitoring setting is invalid");
    }
    const candidate = input as { sourceId?: unknown; enabled?: unknown };
    if (typeof candidate.sourceId !== "string" || typeof candidate.enabled !== "boolean") {
      throw new Error("Skill source monitoring setting is invalid");
    }
    return skillLibraryStore.setSourceMonitored({
      sourceId: candidate.sourceId,
      enabled: candidate.enabled
    });
  });
  handleMutation("skills:set-source-candidate-ignored", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Skill source ignore setting is invalid");
    }
    const candidate = input as {
      sourceId?: unknown;
      sourceSubpath?: unknown;
      ignored?: unknown;
    };
    if (typeof candidate.sourceId !== "string" ||
      typeof candidate.sourceSubpath !== "string" ||
      typeof candidate.ignored !== "boolean") {
      throw new Error("Skill source ignore setting is invalid");
    }
    return skillLibraryStore.setSourceCandidateIgnored({
      sourceId: candidate.sourceId,
      sourceSubpath: candidate.sourceSubpath,
      ignored: candidate.ignored
    });
  });
  handleMutation("skills:preview-source-merge", (_event, input: SkillSourceMergePreviewInput) => {
    if (!input || !Array.isArray(input.sourceIds)) {
      throw new Error("Skill source merge requires a source selection");
    }
    return skillLibraryStore.previewSourceMerge({
      sourceIds: input.sourceIds.map((value) => String(value)),
      directory: typeof input.directory === "string" ? input.directory : undefined,
      rootPath: typeof input.rootPath === "string" ? input.rootPath : undefined
    });
  });
  handleMutation("skills:merge-sources", (_event, previewId: unknown) =>
    skillLibraryStore.mergeSources(String(previewId))
  );
  diagnosticHandle("skills:cancel-repository", () => {
    cancelRepositoryOperations();
  });
  handleMutation("skills:remove-library", async (_event, id: unknown) => {
    const skillId = parseId(id, "skill id");
    const profiles = await readAllProfilesForResourceMutation(
      profileStore,
      "Skill removal"
    );
    const references = [] as string[];
    for (const profile of profiles) {
      if (profile.resources.skills.some((reference) => reference.libraryId === skillId)) {
        references.push(profile.manifest.name);
      }
    }
    if (references.length > 0) {
      throw new Error(
        `Library skill ${skillId} is used by ${references.join(", ")}. Remove it from those profiles first.`
      );
    }
    const targets = await targetDiscoveryService.listTargets();
    const managedInstallPaths = await skillLibraryStore.findManagedInstallPaths(
      skillId,
      targets.map((target) => target.paths)
    );
    return skillLibraryStore.removeSkill(skillId, managedInstallPaths);
  });
  handleMutation("skills:manage-target", async (_event, input: ManageTargetSkillInput) => {
    const targetId = parseId(input.targetId, "target id");
    const libraryId = parseId(input.libraryId, "skill id");
    const targets = await targetDiscoveryService.listTargets();
    const target = targets.find((item) => item.id === targetId);
    if (!target) {
      throw new Error(`Agent not found: ${targetId}`);
    }
    return skillLibraryStore.manageTargetSkill({
      targetPaths: target.paths,
      targetName: input.targetName,
      libraryId
    });
  });
  handleMutation("skills:consolidate-group", async (_event, input: SkillCleanupRequest) => {
    const libraryId = parseId(input.libraryId, "skill library id");
    const skillKey = parseId(input.skillKey, "skill key");
    if (
      input.libraryAction !== undefined &&
      !["create", "keep", "replace"].includes(input.libraryAction)
    ) {
      throw new Error("Invalid Library cleanup action");
    }
    if (
      input.mode !== undefined &&
      !["target-copies", "shared-compatibility"].includes(input.mode)
    ) {
      throw new Error("Invalid Skill cleanup mode");
    }
    const targets = await targetDiscoveryService.listTargets();
    const inventory = await skillLibraryStore.scanInventory(
      inventoryPathsFor(targets)
    );
    const inventoryByPath = new Map(
      inventory.map((item) => [resolve(item.path), item])
    );
    const unavailableLinkCleanup =
      input.libraryAction === "keep" &&
      input.locations.length > 0 &&
      input.locations.every((location) => {
        const current = inventoryByPath.get(resolve(String(location.path)));
        return Boolean(
          current &&
          current.status !== "left-unmanaged" &&
          current.contentHash === "" &&
          current.runtimeIssues?.some(
            (issue) =>
              issue.code === "unreadable-skill" &&
              issue.message.startsWith("Skill link target is unavailable")
          )
        );
      });
    const locations = input.locations.map((location) => {
      const targetId = parseId(location.targetId, "target id");
      const target = targets.find((item) => item.id === targetId);
      if (!target) {
        throw new Error(`Agent not found: ${targetId}`);
      }
      const targetDir = resolve(String(location.path));
      const allowedRoots = [target.paths.skillsDir, ...(target.paths.skillScanDirs ?? [])]
        .filter((path): path is string => Boolean(path))
        .map((path) => resolve(path));
      const isAllowed = allowedRoots.some((root) => {
        return (
          isPathInside(root, targetDir) &&
          pathsEqual(dirname(targetDir), root)
        );
      });
      if (!isAllowed || !basename(targetDir)) {
        throw new Error(`Skill cleanup path is outside ${target.name}: ${targetDir}`);
      }
      const current = inventoryByPath.get(targetDir);
      if (
        !current ||
        current.skillKey !== skillKey ||
        current.contentHash !== location.contentHash
      ) {
        throw new Error(
          `${skillKey} changed after the cleanup preview. Refresh and review it again.`
        );
      }
      assertSharedSkillCleanupAuthority({
        path: targetDir,
        sharedLocation: current.sharedLocation,
        mode: input.mode,
        unavailableLinkCleanup
      });
      if (current.collectionLink) {
        throw new Error(
          `${skillKey} is loaded through collection link ${current.collectionLink.path}. Review the collection instead of changing a child path.`
        );
      }
      return {
        targetPaths: target.paths,
        targetDir,
        legacyOwnershipMarkerPaths: current.legacyOwnershipMarkerPaths ?? []
      };
    });
    if (input.mode === "shared-compatibility") {
      const requestedShared = input.sharedLocations ?? [];
      const sharedPaths = await resolveSharedSkillPaths(
        requestedShared.map((location) => location.path)
      );
      for (const sharedPath of sharedPaths) {
        const expected = requestedShared.find(
          (location) => resolve(location.path) === sharedPath
        );
        const current = inventoryByPath.get(sharedPath);
        if (
          !expected ||
          !current ||
          current.skillKey !== skillKey ||
          current.sharedLocation !== true ||
          (dirname(sharedPath) === agentsSkillsRoot &&
            current.sharedLocationId !== "agents-skills") ||
          current.contentHash !== expected.contentHash
        ) {
          throw new Error(
            `${skillKey} changed after the cleanup preview. Refresh and review it again.`
          );
        }
      }
      const canonicalPath = resolve(String(input.canonicalPath));
      if (![...sharedPaths, ...locations.map((item) => item.targetDir)].includes(canonicalPath)) {
        throw new Error("Source skill must be one of the reviewed cleanup locations");
      }
      return skillLibraryStore.consolidateSharedSkillGroup({
        skillKey,
        libraryId,
        canonicalPath,
        replaceLibrary: input.libraryAction === "replace",
        sharedPaths,
        duplicatePaths: locations.map((item) => item.targetDir)
      });
    }
    if (unavailableLinkCleanup) {
      return skillLibraryStore.removeUnavailableSkillLinks({
        skillKey,
        locations
      });
    }
    return skillLibraryStore.consolidateSkillGroup({
      skillKey,
      libraryId,
      canonicalPath: resolve(String(input.canonicalPath)),
      replaceLibrary: input.libraryAction === "replace",
      locations
    });
  });
  handleMutation("skills:retire-shared", async (_event, input: RetireSharedSkillInput) => {
    const skillKey = parseId(input?.skillKey, "skill key");
    const libraryId = parseId(input?.libraryId, "skill library id");
    const sharedPaths = await resolveSharedSkillPaths(input?.paths);
    const targets = await targetDiscoveryService.listTargets();
    const inventory = await skillLibraryStore.scanInventory(
      inventoryPathsFor(targets)
    );
    const sharedPathSet = new Set(sharedPaths);
    const sharedEntries = inventory.filter(
      (item) =>
        item.skillKey === skillKey &&
        item.sharedLocation === true &&
        sharedPathSet.has(resolve(item.path))
    );
    const collectionEntry = sharedEntries.find((item) => item.collectionLink);
    if (collectionEntry?.collectionLink) {
      throw new Error(
        `${skillKey} is loaded through collection link ${collectionEntry.collectionLink.path}. Migrate the collection as one unit.`
      );
    }
    const matchedPaths = new Set(sharedEntries.map((item) => resolve(item.path)));
    if (
      matchedPaths.size !== sharedPathSet.size ||
      sharedEntries.some(
        (item) => item.libraryId !== libraryId || item.contentMatchesLibrary !== true
      )
    ) {
      throw new Error(
        `${skillKey} cannot remove its shared copy until the exact Library version is available.`
      );
    }
    const installedTargetIds = new Set(
      targets.filter((target) => isTargetInstalled(target.health)).map((target) => target.id)
    );
    const consumerTargetIds = new Set(
      sharedEntries.flatMap((item) => item.foundIn).filter((id) => installedTargetIds.has(id))
    );
    return activationService.completeSharedSkillMigration({
      skillKey,
      libraryId,
      sharedPaths,
      consumerTargetIds: [...consumerTargetIds]
    });
  });
  handleMutation("skills:retire-collection", async (_event, input: {
    path?: unknown;
    profileReceipts?: unknown;
  }) => {
    if (typeof input?.path !== "string" || !input.path.trim()) {
      throw new Error("Skill collection path is required");
    }
    const collectionPath = resolve(input.path);
    if (
      !input.profileReceipts ||
      typeof input.profileReceipts !== "object" ||
      Array.isArray(input.profileReceipts)
    ) {
      throw new Error("Skill collection Profile review is required");
    }
    const profileReceipts = Object.fromEntries(
      Object.entries(input.profileReceipts).map(([targetId, receipt]) => {
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
          throw new Error(`Invalid Profile review for ${targetId}`);
        }
        const candidate = receipt as { profileId?: unknown; contentHash?: unknown };
        if (
          typeof candidate.profileId !== "string" ||
          !candidate.profileId ||
          typeof candidate.contentHash !== "string" ||
          !candidate.contentHash
        ) {
          throw new Error(`Invalid Profile review for ${targetId}`);
        }
        return [parseId(targetId, "target id"), {
          profileId: parseId(candidate.profileId, "profile id"),
          contentHash: candidate.contentHash
        }];
      })
    );
    const targets = await targetDiscoveryService.listTargets();
    const inventory = await skillLibraryStore.scanInventory(
      inventoryPathsFor(targets)
    );
    const collectionEntries = inventory.filter(
      (item) => item.collectionLink &&
        resolve(item.collectionLink.path) === collectionPath
    );
    if (collectionEntries.length === 0) {
      throw new Error("Skill collection changed or is no longer loaded by an installed Agent");
    }
    const canonicalPaths = new Set(
      collectionEntries.map((item) => resolve(item.collectionLink!.canonicalPath))
    );
    if (canonicalPaths.size !== 1) {
      throw new Error("Skill collection target changed during review");
    }
    const unready = collectionEntries.find(
      (item) => !isSkillCollectionItemLibraryReady(item)
    );
    if (unready) {
      throw new Error(
        `${unready.name} needs a reviewed Library version before this collection can move`
      );
    }
    const installedTargetIds = new Set(
      targets.filter((target) => isTargetInstalled(target.health)).map((target) => target.id)
    );
    const members = [...new Map(
      collectionEntries.map((item) => [
        `${item.skillKey}\0${item.libraryId}\0${resolve(item.path)}`,
        {
          skillKey: item.skillKey,
          libraryId: item.libraryId as string,
          sharedPath: item.path,
          consumerTargetIds: item.foundIn.filter((id) => installedTargetIds.has(id)),
          useLibraryVersion: item.collectionDecision === "use-library",
          sourceContentHash: item.contentHash
        }
      ])
    ).values()];
    return activationService.completeSkillCollectionMigration({
      collectionPath,
      canonicalPath: [...canonicalPaths][0],
      profileReceipts,
      members
    });
  });
  handleMutation("skills:rollback-cleanup", async (_event, backupId: unknown) => {
    const id = parseId(backupId, "cleanup backup id");
    const migrationBackups = await activationService.listSharedSkillMigrationBackups();
    if (migrationBackups.some((backup) => backup.id === id)) {
      await activationService.rollbackSharedSkillMigration(id);
      return;
    }
    await skillLibraryStore.rollbackSkillCleanup(id);
  });
  diagnosticHandle("skills:check-updates", async (_event, ids: unknown) => {
    await waitForAutomationBackgroundDelay();
    return skillLibraryStore.checkUpdates(
      Array.isArray(ids) ? ids.map((id) => parseId(id, "skill id")) : undefined
    );
  });
  handleMutation(
    "skills:set-update-settings",
    (_event, input: SkillUpdateSettingsInput) => {
      const policyId = parseId(input?.policy?.id, "skill id");
      const source = input?.source
        ? {
            ...input.source,
            id: parseId(input.source.id, "skill source id")
          }
        : undefined;
      if (source && source.id !== policyId) {
        throw new Error("Skill update source and policy must refer to the same Skill");
      }
      return skillLibraryStore.setUpdateSettings({
        source,
        policy: {
          id: policyId,
          policy: input?.policy?.policy === "tracked" ? "tracked" : "untracked"
        }
      });
    }
  );
  handleMutation(
    "skills:set-availability",
    (_event, input: SkillAvailabilityInput) => {
      if (typeof input?.enabled !== "boolean") {
        throw new Error("Skill availability must be a boolean");
      }
      return skillLibraryStore.setAvailability({
        id: parseId(input?.id, "skill id"),
        enabled: input.enabled
      });
    }
  );
  handleMutation("skills:set-icon", (_event, input: SkillIconInput) =>
    skillLibraryStore.setIcon({
      id: parseId(input?.id, "skill id"),
      iconKey:
        typeof input?.iconKey === "undefined"
          ? undefined
          : ResourceIconKeySchema.parse(input.iconKey)
    })
  );
  diagnosticHandle("skills:preview-update", async (_event, id: unknown) => {
    await waitForAutomationBackgroundDelay();
    return skillLibraryStore.previewUpdate(parseId(id, "skill id"));
  });
  diagnosticHandle("skills:preview-updates", async (_event, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error("Skill update preview requires a list of Skill ids");
    await waitForAutomationBackgroundDelay();
    return skillLibraryStore.previewUpdates(ids.map((id) => parseId(id, "skill id")));
  });
  handleMutation("skills:update-library", (_event, input: SkillUpdateConfirmation) => {
    if (!input || typeof input !== "object" || typeof input.previewId !== "string") {
      throw new Error("Skill update confirmation requires a preview");
    }
    return skillLibraryStore.updateSkill({
      id: parseId(input.id, "skill id"),
      previewId: input.previewId,
      syncCopiedInstalls: input.syncCopiedInstalls === true
    });
  });
  registerSettingsIpc(
    { diagnosticHandle, handleMutation, handleWorkspaceSyncMutation },
    {
      activationService,
      appUpdateService,
      githubAuthService,
      mutationCoordinator,
      settingsStore,
      targetRegistry,
      telemetryService,
      uiStateStore,
      workspaceSyncService
    }
  );
  registerProfileIpc(
    { diagnosticHandle, handleMutation },
    { activationService, evaluationService, profileStore, targetCaptureService }
  );
  registerRecoveryIpc(
    { diagnosticHandle, handleMutation },
    { activationService, backupMaintenanceService, backupStore, mutationCoordinator, paths }
  );
};
