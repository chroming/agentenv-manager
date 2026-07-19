import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ActivationService } from "./activationService";
import type { BackupMaintenanceService } from "./backupMaintenanceService";
import type { BackupStore } from "./backupStore";
import type { GitHubAuthService } from "./githubAuthService";
import type { ProfileStore } from "./profileStore";
import type { SettingsStore } from "./settingsStore";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { TargetDiscoveryService } from "./targetDiscovery";
import type { TargetCaptureService } from "./targetCaptureService";
import { ResourceIconKeySchema, SafeIdSchema } from "../shared/schemas";
import type {
  CreateProfileInput,
  CreateProfileFromTargetInput,
  DeleteManagedBackupInput,
  GitHubSkillImportInput,
  RepositorySkillImportInput,
  RepositorySkillSourceInput,
  ManageTargetSkillInput,
  RetireSharedSkillInput,
  SharedSkillRetentionInput,
  SkillCleanupRequest,
  SkillImportInput,
  SkillImportPreviewInput,
  SkillIconInput,
  SkillMergeInput,
  SaveProfileInput,
  UpdateProfileMetadataInput,
  SkillUpdatePolicyInput,
  SkillUpdateConfirmation,
  SkillAvailabilityInput,
  SkillUpdateSourceInput,
  TargetPaths
} from "../shared/types";
import type { TargetRegistry } from "./targets/registry";
import type { AgentEnvPaths } from "./paths";
import { createDataBackup, inspectDataBackup, restoreDataBackup } from "./dataBackupService";
import { parseExternalUrl } from "./externalUrl";
import { isTargetInstalled } from "../shared/targetHealth";
import { isExternalSkillImportable } from "../shared/skillIdentity";
import type { MutationCoordinator } from "./mutationCoordinator";
import { readAllProfilesForResourceMutation } from "./profileSafety";

export interface IpcServices {
  profileStore: ProfileStore;
  activationService: ActivationService;
  backupStore: BackupStore;
  backupMaintenanceService: BackupMaintenanceService;
  githubAuthService: GitHubAuthService;
  settingsStore: SettingsStore;
  skillLibraryStore: SkillLibraryStore;
  targetRegistry: TargetRegistry;
  targetDiscoveryService: TargetDiscoveryService;
  targetCaptureService: TargetCaptureService;
  mutationCoordinator: MutationCoordinator;
  paths: AgentEnvPaths;
  cancelRepositoryOperations(): void;
}

const parseId = (value: unknown, label: string): string => {
  const parsed = SafeIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid ${label}`);
  }
  return parsed.data;
};

const parseManagedBackupInput = (value: unknown): DeleteManagedBackupInput => {
  if (!value || typeof value !== "object") throw new Error("Invalid backup selection");
  const input = value as { id?: unknown; kind?: unknown };
  if (input.kind !== "target-recovery" && input.kind !== "skill-cleanup") {
    throw new Error("Invalid backup kind");
  }
  return { id: parseId(input.id, "backup id"), kind: input.kind };
};

export const registerIpcHandlers = ({
  profileStore,
  activationService,
  backupStore,
  backupMaintenanceService,
  githubAuthService,
  settingsStore,
  skillLibraryStore,
  targetRegistry,
  targetDiscoveryService,
  targetCaptureService,
  mutationCoordinator,
  paths,
  cancelRepositoryOperations
}: IpcServices) => {
  const handleMutation = (
    channel: string,
    handler: (event: any, ...args: any[]) => any
  ) => {
    ipcMain.handle(channel, (event, ...args) =>
      mutationCoordinator.runExclusive(channel, () => handler(event, ...args))
    );
  };
  const sharedSkillTargetPaths: TargetPaths = {
    targetId: "shared-compatibility",
    configDir: dirname(paths.userSkillsDir),
    instructionsPath: join(dirname(paths.userSkillsDir), "AGENTS.md"),
    configPath: join(dirname(paths.userSkillsDir), "config.json"),
    skillsDir: paths.userSkillsDir,
    skillScanDirs: [paths.userSkillsDir],
    skillLocations: [
      {
        path: paths.userSkillsDir,
        role: "compatibility-runtime",
        shared: true,
        scope: "shared",
        scanDepth: "recursive",
        management: "observed"
      }
    ]
  };
  const inventoryPathsFor = (targets: Awaited<ReturnType<TargetDiscoveryService["listTargets"]>>) => {
    const targetPaths = targets.map((target) => target.paths);
    const sharedRoot = resolve(paths.userSkillsDir);
    const includesSharedRoot = targetPaths.some((target) =>
      (target.skillLocations ?? []).some(
        (location) => location.shared && resolve(location.path) === sharedRoot
      )
    );
    return includesSharedRoot ? targetPaths : [...targetPaths, sharedSkillTargetPaths];
  };
  const automationBackgroundDelayMs =
    process.env.AGENTENV_AUTOMATION === "1"
      ? Math.max(0, Number(process.env.AGENTENV_AUTOMATION_BACKGROUND_DELAY_MS ?? 0))
      : 0;
  const waitForAutomationBackgroundDelay = async () => {
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
      resolve(paths.userSkillsDir),
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

  ipcMain.handle("clipboard:write-text", (_event, text: unknown) => {
    clipboard.writeText(String(text));
  });
  ipcMain.handle("dialog:select-skill-folder", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Select skill folder",
      properties: ["openDirectory"] as Array<"openDirectory">
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("targets:list", (_event, forceRefresh: unknown) =>
    targetDiscoveryService.listTargets({ forceRefresh: forceRefresh === true })
  );
  ipcMain.handle("targets:list-supported", () => targetRegistry.list());
  ipcMain.handle("targets:list-states", () =>
    activationService.listTargetStates()
  );
  ipcMain.handle("targets:list-native-mcps", async () => {
    const targets = await targetDiscoveryService.listTargets();
    const inspections = await Promise.all(
      targets
        .filter((target) => isTargetInstalled(target.health))
        .map(async (target) => {
          try {
            const captured = await targetRegistry
              .get(target.id)
              .captureProfile(target.paths);
            return { connections: captured.mcpConnections ?? [], issues: [] };
          } catch (error) {
            return {
              connections: [],
              issues: [{
                targetId: target.id,
                targetName: target.name,
                sourcePath: target.paths.mcpConfigPath ?? target.paths.configPath,
                message: error instanceof Error ? error.message : String(error)
              }]
            };
          }
        })
    );
    return {
      connections: inspections
        .flatMap((inspection) => inspection.connections)
        .sort(
        (left, right) =>
          left.targetId.localeCompare(right.targetId) ||
          left.name.localeCompare(right.name)
        ),
      issues: inspections.flatMap((inspection) => inspection.issues)
    };
  });
  ipcMain.handle("skills:list-library", () => skillLibraryStore.listSkills());
  ipcMain.handle("skills:scan-inventory", async () => {
    await waitForAutomationBackgroundDelay();
    const targets = await targetDiscoveryService.listTargets();
    return skillLibraryStore.scanInventory(inventoryPathsFor(targets));
  });
  ipcMain.handle("skills:list-cleanup-backups", async () =>
    (await Promise.all([
      activationService.listSharedSkillMigrationBackups(),
      skillLibraryStore.listCleanupBackups()
    ]))
      .flat()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  );
  handleMutation("skills:ignore-group", (_event, skillKey: unknown) =>
    skillLibraryStore.ignoreSkillGroup(String(skillKey))
  );
  handleMutation("skills:unignore-group", (_event, skillKey: unknown) =>
    skillLibraryStore.unignoreSkillGroup(String(skillKey))
  );
  ipcMain.handle("skills:scan-unmanaged", () =>
    targetDiscoveryService
      .listTargets()
      .then((targets) => skillLibraryStore.scanUnmanaged(inventoryPathsFor(targets)))
  );
  ipcMain.handle("skills:preview-import", (_event, input: SkillImportPreviewInput) => {
    if (
      !input ||
      (input.kind !== "local" && input.kind !== "github" && input.kind !== "repository")
    ) {
      throw new Error("Skill import preview requires a local or Repository source");
    }
    return skillLibraryStore.previewImport(input);
  });
  ipcMain.handle("skills:preview-merge", async (_event, id: unknown) => {
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

    if (
      localInstall?.status === "external" &&
      !isExternalSkillImportable(localInstall.externalOwnership)
    ) {
      const manager = localInstall.externalOwnership?.displayName ?? "another tool";
      throw new Error(`${localInstall.name} is managed by ${manager} and cannot be imported from this runtime copy`);
    }

    if (localInstall?.status === "managed" && localInstall.libraryId) {
      const skill = (await skillLibraryStore.listSkills()).find(
        (item) => item.id === localInstall.libraryId
      );
      if (skill) {
        return { skill, managedLocations: [sourcePath], reused: true };
      }
    }

    const canTakeOwnership =
      localInstall &&
      !localInstall.sharedLocation &&
      localInstall.status !== "external" &&
      localInstall.status !== "ignored" &&
      input.conflictResolution?.action !== "update-source" &&
      input.provenance?.externalManager !== "skills-cli";
    if (canTakeOwnership) {
      const preview = await skillLibraryStore.previewImport({ kind: "local", input });
      if (input.expectedContentHash && preview.incoming.contentHash !== input.expectedContentHash) {
        throw new Error("Skill changed after the import preview; review the latest version");
      }
      const resolution = input.conflictResolution;
      const selectedConflict = resolution?.action === "keep-both"
        ? undefined
        : preview.conflicts.find(
            (conflict) => conflict.existing.id === resolution?.existingId
          );
      if (preview.conflicts.length > 0 && !resolution) {
        throw new Error(`Skill name or ID already exists in Library: ${preview.incoming.name}`);
      }
      if (resolution?.action === "reuse") {
        if (!selectedConflict?.identical) {
          throw new Error("Only an identical Library skill can be reused");
        }
      }
      const resolvedLibraryId = resolution?.action === "keep-both"
        ? SafeIdSchema.parse(resolution.id)
        : resolution?.action === "replace"
          ? selectedConflict?.existing.id
          : resolution?.action === "reuse"
            ? selectedConflict?.existing.id
          : preview.incoming.id;
      if (!resolvedLibraryId) throw new Error("The selected Library conflict no longer exists");
      if (
        resolution?.action === "keep-both" &&
        (await skillLibraryStore.listSkills()).some((skill) => skill.id === resolvedLibraryId)
      ) {
        throw new Error(`Library skill already exists: ${resolvedLibraryId}`);
      }
      const target = targets
        .filter((item) => localInstall.foundIn.includes(item.id))
        .sort((left, right) => {
          const leftPreferred = resolve(left.paths.skillsDir ?? "") === dirname(sourcePath);
          const rightPreferred = resolve(right.paths.skillsDir ?? "") === dirname(sourcePath);
          return Number(rightPreferred) - Number(leftPreferred);
        })[0];
      if (!target) {
        throw new Error(`No enabled Agent owns the local Skill path: ${sourcePath}`);
      }
      const cleanup = await skillLibraryStore.consolidateSkillGroup({
        skillKey: localInstall.skillKey,
        libraryId: resolvedLibraryId,
        canonicalPath: sourcePath,
        replaceLibrary: resolution?.action === "replace",
        locations: [{ targetPaths: target.paths, targetDir: sourcePath }]
      });
      const skill = (await skillLibraryStore.listSkills()).find(
        (item) => item.id === cleanup.libraryId
      );
      if (!skill) {
        throw new Error(`Imported Library skill could not be read: ${cleanup.libraryId}`);
      }
      return {
        skill,
        managedLocations: cleanup.managedLocations,
        backupId: cleanup.backupId,
        reused: resolution?.action === "reuse"
      };
    }

    const skill = await skillLibraryStore.importSkill({
      ...input,
      id: libraryId,
      sourcePath
    });
    return {
      skill,
      managedLocations: [],
      reused: input.conflictResolution?.action === "reuse",
      sourceUpdated: input.conflictResolution?.action === "update-source"
    };
  });
  handleMutation("skills:import-github", (_event, input: GitHubSkillImportInput) =>
    skillLibraryStore.importGitHubSkill(input)
  );
  ipcMain.handle("skills:scan-github", (_event, url: unknown) =>
    skillLibraryStore.scanGitHubSkills(String(url))
  );
  handleMutation("skills:import-github-batch", (_event, inputs: GitHubSkillImportInput[]) =>
    skillLibraryStore.importGitHubSkills(Array.isArray(inputs) ? inputs : [])
  );
  ipcMain.handle("skills:scan-repository", (_event, input: RepositorySkillSourceInput) => {
    if (!input || typeof input !== "object" || typeof input.repository !== "string") {
      throw new Error("Repository scan requires a repository address");
    }
    return skillLibraryStore.scanRepositorySkills(input);
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
  ipcMain.handle("skills:cancel-repository", () => {
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
        const child = relative(root, targetDir);
        return child.length > 0 && !child.startsWith("..") && !child.includes("/../") && dirname(targetDir) === root;
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
      return { targetPaths: target.paths, targetDir };
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
    return skillLibraryStore.consolidateSkillGroup({
      skillKey,
      libraryId,
      canonicalPath: resolve(String(input.canonicalPath)),
      replaceLibrary: input.libraryAction === "replace",
      locations
    });
  });
  handleMutation(
    "skills:set-shared-retention",
    async (_event, input: SharedSkillRetentionInput) => {
      const skillKey = parseId(input?.skillKey, "skill key");
      const sharedPaths = await resolveSharedSkillPaths(input?.paths);
      await skillLibraryStore.setSharedSkillRetention({
        skillKey,
        paths: sharedPaths,
        retained: Boolean(input?.retained)
      });
    }
  );
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
  handleMutation("skills:rollback-cleanup", async (_event, backupId: unknown) => {
    const id = parseId(backupId, "cleanup backup id");
    const migrationBackups = await activationService.listSharedSkillMigrationBackups();
    if (migrationBackups.some((backup) => backup.id === id)) {
      await activationService.rollbackSharedSkillMigration(id);
      return;
    }
    await skillLibraryStore.rollbackSkillCleanup(id);
  });
  ipcMain.handle("skills:check-updates", async (_event, ids: unknown) => {
    await waitForAutomationBackgroundDelay();
    return skillLibraryStore.checkUpdates(
      Array.isArray(ids) ? ids.map((id) => parseId(id, "skill id")) : undefined
    );
  });
  handleMutation("skills:set-update-source", (_event, input: SkillUpdateSourceInput) =>
    skillLibraryStore.setUpdateSource(input)
  );
  handleMutation(
    "skills:set-update-policy",
    (_event, input: SkillUpdatePolicyInput) =>
      skillLibraryStore.setUpdatePolicy({
        id: parseId(input?.id, "skill id"),
        policy: input?.policy === "tracked" ? "tracked" : "untracked"
      })
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
      iconKey: ResourceIconKeySchema.parse(input?.iconKey)
    })
  );
  ipcMain.handle("skills:preview-update", (_event, id: unknown) =>
    skillLibraryStore.previewUpdate(parseId(id, "skill id"))
  );
  handleMutation("skills:update-library", (_event, input: SkillUpdateConfirmation) => {
    if (!input || typeof input !== "object" || typeof input.previewId !== "string") {
      throw new Error("Skill update confirmation requires a preview");
    }
    return skillLibraryStore.updateSkill({
      id: parseId(input.id, "skill id"),
      previewId: input.previewId
    });
  });
  handleMutation("settings:read", () => settingsStore.readSettings());
  handleMutation("settings:update", (_event, input: unknown) =>
    settingsStore.updateSettings(input && typeof input === "object" ? input : {})
  );
  handleMutation("github:status", () => githubAuthService.readStatus());
  ipcMain.handle("github:start-device-login", () => githubAuthService.startDeviceLogin());
  handleMutation("github:poll-device-login", (_event, id: unknown) =>
    githubAuthService.pollDeviceLogin(String(id))
  );
  handleMutation("github:sign-out", () => githubAuthService.signOut());
  ipcMain.handle("github:open-device-page", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
  ipcMain.handle("external:open-url", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
  ipcMain.handle("profiles:list", () => profileStore.listProfiles());
  ipcMain.handle("profiles:read", async (_event, id: unknown) => {
    const profileId = parseId(id, "profile id");
    const testDelayMs = Number(process.env.AGENTENV_TEST_PROFILE_READ_DELAY_MS ?? 0);
    if (
      process.env.AGENTENV_AUTOMATION === "1" &&
      process.env.AGENTENV_TEST_PROFILE_READ_DELAY_ID === profileId &&
      Number.isFinite(testDelayMs) &&
      testDelayMs > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, testDelayMs));
    }
    return profileStore.readProfile(profileId);
  });
  handleMutation("profiles:save", (_event, input: SaveProfileInput) =>
    profileStore.saveProfile(input)
  );
  handleMutation(
    "profiles:update-metadata",
    (_event, input: UpdateProfileMetadataInput) => profileStore.updateProfileMetadata(input)
  );
  handleMutation("profiles:create", (_event, input: CreateProfileInput | string) =>
    profileStore.createProfile(
      typeof input === "string" ? { preferredTargetId: parseId(input, "target id") } : input
    )
  );
  ipcMain.handle("profiles:preview-create-from-target", (_event, targetId: unknown) =>
    targetCaptureService.previewTarget(parseId(targetId, "target id"))
  );
  handleMutation("profiles:create-from-target", (_event, input: CreateProfileFromTargetInput) =>
    targetCaptureService.createFromTarget(input)
  );
  handleMutation("profiles:duplicate", (_event, id: unknown) =>
    profileStore.duplicateProfile(parseId(id, "profile id"))
  );
  handleMutation("profiles:delete", async (_event, id: unknown) => {
    const profileId = parseId(id, "profile id");
    const activeTarget = (await activationService.listTargetStates()).find(
      (state) => state.activeProfileId === profileId
    );
    if (activeTarget) {
      throw new Error("Apply another profile before removing this active profile");
    }
    await profileStore.deleteProfile(profileId);
  });
  ipcMain.handle("activation:preview", (_event, profileId: unknown, targetId?: unknown) =>
    activationService.previewProfile(
      parseId(profileId, "profile id"),
      targetId === undefined ? undefined : parseId(targetId, "target id")
    )
  );
  handleMutation(
    "activation:apply",
    (_event, profileId: unknown, previewId: unknown, options: unknown) =>
      activationService.applyProfile(
        parseId(profileId, "profile id"),
        String(previewId),
        options && typeof options === "object"
          ? {
              allowManagedDrift:
                (options as { allowManagedDrift?: unknown }).allowManagedDrift === true,
              allowUnmanagedSkillReplacement:
                (options as { allowUnmanagedSkillReplacement?: unknown })
                  .allowUnmanagedSkillReplacement === true
            }
          : undefined
      )
  );
  ipcMain.handle("backups:list", () => backupStore.listBackups());
  ipcMain.handle("backups:list-managed", () => backupMaintenanceService.listInventory());
  handleMutation("backups:delete-managed", (_event, input: unknown) =>
    backupMaintenanceService.deleteBackup(parseManagedBackupInput(input))
  );
  handleMutation("backups:cleanup-managed", () => backupMaintenanceService.cleanup());
  ipcMain.handle("rollback:preview", (_event, backupId: unknown) =>
    activationService.previewRollback(String(backupId))
  );
  handleMutation("rollback:apply", (_event, backupId: unknown) =>
    activationService.rollback(String(backupId))
  );
  ipcMain.handle("targets:preview-stop-managing", (_event, targetId: unknown, mode: unknown) =>
    activationService.previewStopManaging(
      parseId(targetId, "target id"),
      mode === "restore-pre-takeover" ? "restore-pre-takeover" : "keep-current"
    )
  );
  handleMutation("targets:stop-managing", (_event, previewId: unknown) =>
    activationService.stopManaging(String(previewId))
  );
  ipcMain.handle("data:create-backup", async () => {
    const owner = BrowserWindow.getFocusedWindow();
    const options = {
      title: "Choose AgentEnv backup location",
      buttonLabel: "Create backup here",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const destination = result.filePaths[0];
    return result.canceled || !destination
      ? undefined
      : mutationCoordinator.runExclusive("data:create-backup", () =>
          createDataBackup(paths, destination)
        );
  });
  ipcMain.handle("data:open-folder", () => shell.openPath(paths.appDataRoot));
  ipcMain.handle("data:select-restore", async () => {
    const owner = BrowserWindow.getFocusedWindow();
    const options = {
      title: "Select AgentEnv backup",
      buttonLabel: "Review backup",
      properties: ["openDirectory"] as Array<"openDirectory">
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    return result.canceled || !selected ? undefined : inspectDataBackup(selected);
  });
  handleMutation("data:restore", (_event, path: unknown) =>
    restoreDataBackup(paths, String(path))
  );
  handleMutation("targets:adopt-changes", (_event, profileId: unknown, targetId: unknown) =>
    activationService.adoptTargetChanges(
      parseId(profileId, "profile id"),
      parseId(targetId, "target id")
    )
  );
};
