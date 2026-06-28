import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { ActivationService } from "./activationService";
import type { BackupStore } from "./backupStore";
import type { GitHubAuthService } from "./githubAuthService";
import type { McpLibraryStore } from "./mcpLibraryStore";
import type { ProfileStore } from "./profileStore";
import type { SettingsStore } from "./settingsStore";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { TargetDiscoveryService } from "./targetDiscovery";
import { SafeIdSchema } from "../shared/schemas";
import type {
  CreateProfileInput,
  GitHubSkillImportInput,
  ManageTargetSkillInput,
  SaveMcpServerInput,
  SaveProfileInput,
  SkillUpdateSourceInput
} from "../shared/types";
import type { TargetRegistry } from "./targets/registry";

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
  targetDiscoveryService
}: IpcServices) => {
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
  ipcMain.handle("skills:list-library", () => skillLibraryStore.listSkills());
  ipcMain.handle("skills:scan-inventory", () =>
    targetDiscoveryService
      .listTargets()
      .then((targets) => skillLibraryStore.scanInventory(targets.map((target) => target.paths)))
  );
  ipcMain.handle("mcp:list-library", () => mcpLibraryStore.listServers());
  ipcMain.handle("mcp:save-library", (_event, input: SaveMcpServerInput) =>
    mcpLibraryStore.saveServer(input)
  );
  ipcMain.handle("mcp:remove-library", (_event, id: unknown) =>
    mcpLibraryStore.removeServer(parseId(id, "MCP server id"))
  );
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
  ipcMain.handle("skills:check-updates", () => skillLibraryStore.checkUpdates());
  ipcMain.handle("skills:set-update-source", (_event, input: SkillUpdateSourceInput) =>
    skillLibraryStore.setUpdateSource(input)
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
    shell.openExternal(String(url))
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
  ipcMain.handle("profiles:delete", (_event, id: unknown) =>
    profileStore.deleteProfile(parseId(id, "profile id"))
  );
  ipcMain.handle("activation:preview", (_event, profileId: unknown) =>
    activationService.previewProfile(parseId(profileId, "profile id"))
  );
  ipcMain.handle(
    "activation:apply",
    (_event, profileId: unknown, previewId: unknown) =>
      activationService.applyProfile(
        parseId(profileId, "profile id"),
        String(previewId)
      )
  );
  ipcMain.handle("backups:list", () => backupStore.listBackups());
  ipcMain.handle("rollback:preview", (_event, backupId: unknown) =>
    activationService.previewRollback(String(backupId))
  );
  ipcMain.handle("rollback:apply", (_event, backupId: unknown) =>
    activationService.rollback(String(backupId))
  );
};
