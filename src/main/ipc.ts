import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { basename, dirname, relative, resolve } from "node:path";
import type { ActivationService } from "./activationService";
import type { BackupStore } from "./backupStore";
import type { GitHubAuthService } from "./githubAuthService";
import type { McpLibraryStore } from "./mcpLibraryStore";
import type { ProfileStore } from "./profileStore";
import type { SettingsStore } from "./settingsStore";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { TargetDiscoveryService } from "./targetDiscovery";
import { ResourceIconKeySchema, SafeIdSchema } from "../shared/schemas";
import type {
  CreateProfileInput,
  GitHubSkillImportInput,
  ManageTargetSkillInput,
  SkillCleanupRequest,
  SkillIconInput,
  SaveMcpServerInput,
  SaveProfileInput,
  SkillUpdatePolicyInput,
  SkillUpdateSourceInput
} from "../shared/types";
import type { TargetRegistry } from "./targets/registry";
import type { AgentEnvPaths } from "./paths";
import { createDataBackup, inspectDataBackup, restoreDataBackup } from "./dataBackupService";
import { parseExternalUrl } from "./externalUrl";

export interface IpcServices {
  profileStore: ProfileStore;
  activationService: ActivationService;
  backupStore: BackupStore;
  githubAuthService: GitHubAuthService;
  settingsStore: SettingsStore;
  skillLibraryStore: SkillLibraryStore;
  mcpLibraryStore: McpLibraryStore;
  targetRegistry: TargetRegistry;
  targetDiscoveryService: TargetDiscoveryService;
  paths: AgentEnvPaths;
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
  activationService,
  backupStore,
  githubAuthService,
  settingsStore,
  skillLibraryStore,
  mcpLibraryStore,
  targetRegistry,
  targetDiscoveryService,
  paths
}: IpcServices) => {
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
  ipcMain.handle("targets:list", () => targetDiscoveryService.listTargets());
  ipcMain.handle("targets:list-states", () => activationService.listTargetStates());
  ipcMain.handle("skills:list-library", () => skillLibraryStore.listSkills());
  ipcMain.handle("skills:scan-inventory", () =>
    targetDiscoveryService
      .listTargets()
      .then((targets) => skillLibraryStore.scanInventory(targets.map((target) => target.paths)))
  );
  ipcMain.handle("skills:list-cleanup-backups", () =>
    skillLibraryStore.listCleanupBackups()
  );
  ipcMain.handle("skills:ignore-group", (_event, skillKey: unknown) =>
    skillLibraryStore.ignoreSkillGroup(String(skillKey))
  );
  ipcMain.handle("skills:unignore-group", (_event, skillKey: unknown) =>
    skillLibraryStore.unignoreSkillGroup(String(skillKey))
  );
  ipcMain.handle("mcp:list-library", () => mcpLibraryStore.listServers());
  ipcMain.handle("mcp:save-library", (_event, input: SaveMcpServerInput) =>
    mcpLibraryStore.saveServer(input)
  );
  ipcMain.handle("mcp:remove-library", async (_event, id: unknown) => {
    const serverId = parseId(id, "MCP server id");
    const references: string[] = [];
    for (const profile of await profileStore.listProfiles()) {
      const detail = await profileStore.readProfile(profile.id);
      if (detail.assetPolicy.mcpRefs?.some((reference) => reference.libraryId === serverId)) {
        references.push(detail.manifest.name);
      }
    }
    if (references.length > 0) {
      throw new Error(
        `MCP server ${serverId} is used by ${references.join(", ")}. Remove it from those profiles first.`
      );
    }
    return mcpLibraryStore.removeServer(serverId);
  });
  ipcMain.handle("skills:scan-unmanaged", () =>
    targetDiscoveryService
      .listTargets()
      .then((targets) => skillLibraryStore.scanUnmanaged(targets.map((target) => target.paths)))
  );
  ipcMain.handle("skills:import-library", (_event, sourcePath: unknown) =>
    skillLibraryStore.importSkill({ sourcePath: String(sourcePath) })
  );
  ipcMain.handle("skills:import-github", (_event, input: GitHubSkillImportInput) =>
    skillLibraryStore.importGitHubSkill(input)
  );
  ipcMain.handle("skills:scan-github", (_event, url: unknown) =>
    skillLibraryStore.scanGitHubSkills(String(url))
  );
  ipcMain.handle("skills:import-github-batch", (_event, inputs: GitHubSkillImportInput[]) =>
    skillLibraryStore.importGitHubSkills(Array.isArray(inputs) ? inputs : [])
  );
  ipcMain.handle("skills:remove-library", async (_event, id: unknown) => {
    const skillId = parseId(id, "skill id");
    const profiles = await profileStore.listProfiles();
    const references = [] as string[];
    for (const profile of profiles) {
      const detail = await profileStore.readProfile(profile.id);
      if (detail.assetPolicy.skillRefs?.some((reference) => reference.libraryId === skillId)) {
        references.push(detail.manifest.name);
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
  ipcMain.handle("skills:manage-target", async (_event, input: ManageTargetSkillInput) => {
    const targetId = parseId(input.targetId, "target id");
    const libraryId = parseId(input.libraryId, "skill id");
    const targets = await targetDiscoveryService.listTargets();
    const target = targets.find((item) => item.id === targetId);
    if (!target) {
      throw new Error(`Target not found: ${targetId}`);
    }
    return skillLibraryStore.manageTargetSkill({
      targetPaths: target.paths,
      targetName: input.targetName,
      libraryId
    });
  });
  ipcMain.handle("skills:consolidate-group", async (_event, input: SkillCleanupRequest) => {
    const libraryId = parseId(input.libraryId, "skill library id");
    const skillKey = parseId(input.skillKey, "skill key");
    const targets = await targetDiscoveryService.listTargets();
    const locations = input.locations.map((location) => {
      const targetId = parseId(location.targetId, "target id");
      const target = targets.find((item) => item.id === targetId);
      if (!target) {
        throw new Error(`Target not found: ${targetId}`);
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
      return { targetPaths: target.paths, targetDir };
    });
    return skillLibraryStore.consolidateSkillGroup({
      skillKey,
      libraryId,
      canonicalPath: resolve(String(input.canonicalPath)),
      locations
    });
  });
  ipcMain.handle("skills:rollback-cleanup", (_event, backupId: unknown) =>
    skillLibraryStore.rollbackSkillCleanup(parseId(backupId, "cleanup backup id"))
  );
  ipcMain.handle("skills:check-updates", () => skillLibraryStore.checkUpdates());
  ipcMain.handle("skills:set-update-source", (_event, input: SkillUpdateSourceInput) =>
    skillLibraryStore.setUpdateSource(input)
  );
  ipcMain.handle(
    "skills:set-update-policy",
    (_event, input: SkillUpdatePolicyInput) =>
      skillLibraryStore.setUpdatePolicy({
        id: parseId(input?.id, "skill id"),
        policy: input?.policy === "tracked" ? "tracked" : "untracked"
      })
  );
  ipcMain.handle("skills:set-icon", (_event, input: SkillIconInput) =>
    skillLibraryStore.setIcon({
      id: parseId(input?.id, "skill id"),
      iconKey: ResourceIconKeySchema.parse(input?.iconKey)
    })
  );
  ipcMain.handle("skills:preview-update", (_event, id: unknown) =>
    skillLibraryStore.previewUpdate(parseId(id, "skill id"))
  );
  ipcMain.handle("skills:update-library", (_event, id: unknown) =>
    skillLibraryStore.updateSkill(parseId(id, "skill id"))
  );
  ipcMain.handle("settings:read", () => settingsStore.readSettings());
  ipcMain.handle("settings:update", (_event, input: unknown) =>
    settingsStore.updateSettings(input && typeof input === "object" ? input : {})
  );
  ipcMain.handle("github:status", () => githubAuthService.readStatus());
  ipcMain.handle("github:start-device-login", () => githubAuthService.startDeviceLogin());
  ipcMain.handle("github:poll-device-login", (_event, id: unknown) =>
    githubAuthService.pollDeviceLogin(String(id))
  );
  ipcMain.handle("github:sign-out", () => githubAuthService.signOut());
  ipcMain.handle("github:open-device-page", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
  ipcMain.handle("external:open-url", (_event, url: unknown) =>
    shell.openExternal(parseExternalUrl(url))
  );
  ipcMain.handle("profiles:list", () => profileStore.listProfiles());
  ipcMain.handle("profiles:read", (_event, id: unknown) =>
    profileStore.readProfile(parseId(id, "profile id"))
  );
  ipcMain.handle("profiles:save", (_event, input: SaveProfileInput) =>
    profileStore.saveProfile(input)
  );
  ipcMain.handle("profiles:create", (_event, input: CreateProfileInput | string) =>
    profileStore.createProfile(
      typeof input === "string" ? { targetId: parseId(input, "target id") } : input
    )
  );
  ipcMain.handle("profiles:duplicate", (_event, id: unknown) =>
    profileStore.duplicateProfile(parseId(id, "profile id"))
  );
  ipcMain.handle("profiles:delete", async (_event, id: unknown) => {
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
  ipcMain.handle(
    "activation:apply",
    (_event, profileId: unknown, previewId: unknown, options: unknown) =>
      activationService.applyProfile(
        parseId(profileId, "profile id"),
        String(previewId),
        options && typeof options === "object"
          ? {
              allowManagedDrift:
                (options as { allowManagedDrift?: unknown }).allowManagedDrift === true,
              allowOmissions:
                (options as { allowOmissions?: unknown }).allowOmissions === true
            }
          : undefined
      )
  );
  ipcMain.handle("backups:list", () => backupStore.listBackups());
  ipcMain.handle("rollback:preview", (_event, backupId: unknown) =>
    activationService.previewRollback(String(backupId))
  );
  ipcMain.handle("rollback:apply", (_event, backupId: unknown) =>
    activationService.rollback(String(backupId))
  );
  ipcMain.handle("targets:preview-stop-managing", (_event, targetId: unknown, mode: unknown) =>
    activationService.previewStopManaging(
      parseId(targetId, "target id"),
      mode === "restore-pre-takeover" ? "restore-pre-takeover" : "keep-current"
    )
  );
  ipcMain.handle("targets:stop-managing", (_event, previewId: unknown) =>
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
      : createDataBackup(paths, destination);
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
  ipcMain.handle("data:restore", (_event, path: unknown) =>
    restoreDataBackup(paths, String(path))
  );
  ipcMain.handle("targets:adopt-instructions", (_event, profileId: unknown, targetId: unknown) =>
    activationService.adoptTargetInstructions(
      parseId(profileId, "profile id"),
      parseId(targetId, "target id")
    )
  );
};
