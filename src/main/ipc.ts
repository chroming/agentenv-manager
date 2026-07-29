import {
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions
} from "electron";
import { stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ActivationService } from "./activationService";
import type { BackupMaintenanceService } from "./backupMaintenanceService";
import type { BackupStore } from "./backupStore";
import type { GitHubAuthService } from "./githubAuthService";
import type { ProfileStore } from "./profileStore";
import type { SettingsStore } from "./settingsStore";
import type { WorkspaceSyncService } from "./workspaceSync/workspaceSyncService";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { TargetDiscoveryService } from "./targetDiscovery";
import type { TargetCaptureService } from "./targetCaptureService";
import { ResourceIconKeySchema, SafeIdSchema } from "../shared/schemas";
import type {
  CreateProfileInput,
  CreateProfileFromTargetInput,
  DeleteManagedBackupInput,
  ForkProfileSkillsInput,
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
  SkillPathPolicyUpdate,
  SkillSourceMergePreviewInput,
  SaveProfileInput,
  UpdateProfileMetadataInput,
  UpdateProfileSkillsInput,
  SkillUpdateSettingsInput,
  SkillUpdateConfirmation,
  SkillAvailabilityInput,
  TargetCaptureScope,
  TargetPaths
} from "../shared/types";
import type { TargetRegistry } from "./targets/registry";
import type { AgentEnvPaths } from "./paths";
import { createDataBackup, inspectDataBackup, restoreDataBackup } from "./dataBackupService";
import { parseExternalUrl } from "./externalUrl";
import { isTargetInstalled } from "../shared/targetHealth";
import type { MutationCoordinator } from "./mutationCoordinator";
import { readAllProfilesForResourceMutation } from "./profileSafety";
import { parseDesktopContextMenuItems } from "../shared/desktopContextMenu";
import { pathEntryExists } from "./fileUtils";
import { createSkillArchiveService } from "./skillArchiveService";
import { createSkillFileBrowser } from "./skillFileBrowser";
import type { ConversationService } from "./conversations/conversationService";
import {
  assertSharedSkillCleanupAuthority,
  materializeSharedSkillLocations,
  resolveSharedSkillLocation
} from "./targets/sharedSkillLocations";
import type { RuntimeDiagnostics } from "./runtimeDiagnostics";

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
  conversationService: ConversationService;
  targetCaptureService: TargetCaptureService;
  mutationCoordinator: MutationCoordinator;
  paths: AgentEnvPaths;
  workspaceSyncService: WorkspaceSyncService;
  diagnostics: RuntimeDiagnostics;
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
  if (input.kind !== "target-recovery" && input.kind !== "skill-cleanup" && input.kind !== "workspace-sync") {
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
  conversationService,
  targetCaptureService,
  mutationCoordinator,
  paths,
  workspaceSyncService,
  diagnostics,
  cancelRepositoryOperations
}: IpcServices) => {
  const skillArchiveService = createSkillArchiveService();
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
        const changesWorkspace = /^(skills|profiles|activation|targets|data|settings|workspace-sync):/.test(channel);
        if (
          changesWorkspace &&
          channel !== "workspace-sync:recover" &&
          await pathEntryExists(paths.workspaceSyncJournalPath)
        ) {
          throw new Error("Workspace recovery is required before changing Profiles, Library resources, or Agents");
        }
        return handler(event, ...args);
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
        if (
          channel !== "workspace-sync:recover" &&
          await pathEntryExists(paths.workspaceSyncJournalPath)
        ) {
          throw new Error("Workspace recovery is required before changing Profiles, Library resources, or Agents");
        }
        return handler(event, ...args);
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

  diagnosticHandle("clipboard:write-text", (_event, text: unknown) => {
    clipboard.writeText(String(text));
  });
  diagnosticHandle("conversations:list", (_event, input: unknown) =>
    conversationService.list(input && typeof input === "object" ? input : undefined)
  );
  diagnosticHandle("conversations:read", (_event, id: unknown, input: unknown) =>
    conversationService.read(
      String(id ?? ""),
      input && typeof input === "object" ? input : undefined
    )
  );
  diagnosticHandle("conversations:refresh", () => conversationService.refresh());
  diagnosticHandle("conversations:open-original", (_event, id: unknown) =>
    conversationService.openOriginal(String(id ?? ""))
  );
  diagnosticHandle("conversations:preview-continue", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Conversation continuation requires a source and target");
    }
    const value = input as { conversationId?: unknown; targetId?: unknown };
    return conversationService.previewContinuation({
      conversationId: String(value.conversationId ?? ""),
      targetId: parseId(value.targetId, "target id")
    });
  });
  diagnosticHandle("conversations:continue", (_event, previewId: unknown) =>
    conversationService.continue(String(previewId ?? ""))
  );
  diagnosticHandle("menu:open-context", (event, value: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return undefined;
    const items = parseDesktopContextMenuItems(value);

    return new Promise<string | undefined>((resolveSelection) => {
      let resolved = false;
      const finish = (selection?: string) => {
        if (resolved) return;
        resolved = true;
        resolveSelection(selection);
      };
      const template: MenuItemConstructorOptions[] = items.map((item) =>
        "type" in item
          ? { type: "separator" }
          : {
              label: item.label,
              enabled: item.enabled,
              click: () => finish(item.id)
            }
      );
      Menu.buildFromTemplate(template).popup({
        window,
        callback: () => setImmediate(() => finish())
      });
    });
  });
  diagnosticHandle("dialog:select-skill-folder", async (event) => {
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
  diagnosticHandle("dialog:select-local-skill-source", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Select Skill folder or ZIP",
      properties: ["openFile", "openDirectory"] as Array<"openFile" | "openDirectory">,
      filters: [{ name: "Skill sources", extensions: ["zip"] }]
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return undefined;
    const selectedPath = result.filePaths[0];
    const selectedStats = await stat(selectedPath);
    if (selectedStats.isDirectory()) {
      const path = resolve(selectedPath);
      return { kind: "folder", path, rootPath: path };
    }
    return skillArchiveService.prepare(selectedPath);
  });
  diagnosticHandle("skills:release-archive", (_event, token: unknown) =>
    skillArchiveService.release(String(token))
  );
  diagnosticHandle("dialog:select-target-config-root", async (event, targetId: unknown) => {
    const id = parseId(targetId, "target id");
    const target = targetRegistry.get(id).descriptor;
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: `Select ${target.name} configuration folder`,
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  diagnosticHandle("targets:list", (_event, forceRefresh: unknown) =>
    targetDiscoveryService.listTargets({ forceRefresh: forceRefresh === true })
  );
  diagnosticHandle("targets:list-supported", () => targetRegistry.list());
  diagnosticHandle("targets:list-states", () =>
    activationService.listTargetStates()
  );
  diagnosticHandle("targets:list-native-mcps", async () => {
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
    return skillLibraryStore.scanInventory(inventoryPathsFor(targets));
  });
  diagnosticHandle("skills:list-cleanup-backups", async () =>
    (await Promise.all([
      activationService.listSharedSkillMigrationBackups(),
      skillLibraryStore.listCleanupBackups()
    ]))
      .flat()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  );
  handleMutation("skills:set-path-policies", (_event, input: SkillPathPolicyUpdate) => {
    if (!input || !Array.isArray(input.items)) {
      throw new Error("Skill path policy requires at least one path");
    }
    if (input.mode !== undefined && !["keep-outside", "keep-shared"].includes(input.mode)) {
      throw new Error("Invalid Skill path policy");
    }
    return skillLibraryStore.setSkillPathPolicies(input);
  });
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
          current.status !== "kept-outside" &&
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
  handleMutation("skills:retire-collection", async (_event, input: { path?: unknown }) => {
    if (typeof input?.path !== "string" || !input.path.trim()) {
      throw new Error("Skill collection path is required");
    }
    const collectionPath = resolve(input.path);
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
      (item) => !item.libraryId || item.contentMatchesLibrary !== true
    );
    if (unready) {
      throw new Error(
        `${unready.name} must match an exact Library copy before this collection can move`
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
          consumerTargetIds: item.foundIn.filter((id) => installedTargetIds.has(id))
        }
      ])
    ).values()];
    return activationService.completeSkillCollectionMigration({
      collectionPath,
      canonicalPath: [...canonicalPaths][0],
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
      previewId: input.previewId
    });
  });
  handleMutation("settings:read", () => settingsStore.readSettings());
  handleMutation("settings:update", async (_event, input: unknown) => {
    const nextInput = input && typeof input === "object"
      ? input as Partial<import("../shared/types").AgentEnvSettings>
      : {};
    if (nextInput.targetConfigRoots) {
      const current = await settingsStore.readSettings();
      const changedTargetIds = new Set([
        ...Object.keys(current.targetConfigRoots ?? {}),
        ...Object.keys(nextInput.targetConfigRoots)
      ].filter((targetId) =>
        current.targetConfigRoots?.[targetId] !== nextInput.targetConfigRoots?.[targetId]
      ));
      if (changedTargetIds.size > 0) {
        const managed = (await activationService.listTargetStates({ includeDisabled: true })).find(
          (state) => changedTargetIds.has(state.targetId) && state.lifecycleStatus !== "unmanaged"
        );
        if (managed) {
          throw new Error(
            `Stop managing ${targetRegistry.get(managed.targetId).descriptor.name} before changing its configuration folder`
          );
        }
      }
    }
    return settingsStore.updateSettings(nextInput);
  });
  diagnosticHandle("workspace-sync:status", () => workspaceSyncService.readStatus());
  handleWorkspaceSyncMutation("workspace-sync:connect", (_event, input: unknown) =>
    workspaceSyncService.connect(input as import("../shared/workspaceSync").WorkspaceSyncConnectInput)
  );
  diagnosticHandle("workspace-sync:check", () => workspaceSyncService.check());
  diagnosticHandle("workspace-sync:review", () => workspaceSyncService.review());
  handleWorkspaceSyncMutation("workspace-sync:update", (_event, input: unknown) =>
    workspaceSyncService.update(input as import("../shared/workspaceSync").WorkspaceSyncUpdateInput)
  );
  handleWorkspaceSyncMutation("workspace-sync:publish", () => workspaceSyncService.publish());
  handleWorkspaceSyncMutation("workspace-sync:recover", () => workspaceSyncService.recover());
  handleWorkspaceSyncMutation("workspace-sync:disconnect", () => workspaceSyncService.disconnect());
  handleMutation("github:status", () => githubAuthService.readStatus());
  diagnosticHandle("github:start-device-login", () => githubAuthService.startDeviceLogin());
  handleMutation("github:poll-device-login", (_event, id: unknown) =>
    githubAuthService.pollDeviceLogin(String(id))
  );
  handleMutation("github:sign-out", () => githubAuthService.signOut());
  diagnosticHandle("github:open-device-page", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
  diagnosticHandle("external:open-url", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
  diagnosticHandle("profiles:list", () => profileStore.listProfiles());
  diagnosticHandle("profiles:read", async (_event, id: unknown) => {
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
  handleMutation("profiles:update-skills", (_event, input: UpdateProfileSkillsInput) =>
    profileStore.updateProfileSkills(input)
  );
  handleMutation("profiles:fork-skills", (_event, input: ForkProfileSkillsInput) =>
    profileStore.forkProfileSkills(input)
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
  diagnosticHandle(
    "profiles:preview-create-from-target",
    (_event, targetId: unknown, scope: TargetCaptureScope | undefined) => {
      if (scope !== undefined && scope !== "all" && scope !== "skills") {
        throw new Error("Invalid capture scope");
      }
      return targetCaptureService.previewTarget(
        parseId(targetId, "target id"),
        scope
      );
    }
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
  diagnosticHandle("activation:preview", (_event, profileId: unknown, targetId?: unknown) =>
    activationService.previewProfile(
      parseId(profileId, "profile id"),
      targetId === undefined ? undefined : parseId(targetId, "target id")
    )
  );
  handleMutation(
    "activation:apply",
    (_event, profileId: unknown, previewId: unknown) =>
      activationService.applyProfile(
        parseId(profileId, "profile id"),
        String(previewId)
      )
  );
  diagnosticHandle("backups:list", () => backupStore.listBackups());
  diagnosticHandle("backups:list-managed", () => backupMaintenanceService.listInventory());
  diagnosticHandle("backups:preview-managed", (_event, input: unknown) =>
    backupMaintenanceService.previewBackup(parseManagedBackupInput(input))
  );
  handleMutation("backups:delete-managed", (_event, input: unknown) =>
    backupMaintenanceService.deleteBackup(parseManagedBackupInput(input))
  );
  handleMutation("backups:cleanup-managed", () => backupMaintenanceService.cleanup());
  diagnosticHandle("rollback:preview", (_event, backupId: unknown) =>
    activationService.previewRollback(String(backupId))
  );
  handleMutation("rollback:apply", (_event, backupId: unknown) =>
    activationService.rollback(String(backupId))
  );
  diagnosticHandle("targets:preview-stop-managing", (_event, targetId: unknown, mode: unknown) =>
    activationService.previewStopManaging(
      parseId(targetId, "target id"),
      mode === "restore-pre-takeover" ? "restore-pre-takeover" : "keep-current"
    )
  );
  handleMutation("targets:stop-managing", (_event, previewId: unknown) =>
    activationService.stopManaging(String(previewId))
  );
  diagnosticHandle("data:create-backup", async () => {
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
  diagnosticHandle("data:root", () => paths.appDataRoot);
  diagnosticHandle("data:open-folder", () => shell.openPath(paths.appDataRoot));
  diagnosticHandle("data:select-restore", async () => {
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
