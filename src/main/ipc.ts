import { ipcMain } from "electron";
import type { ActivationService } from "./activationService";
import type { BackupStore } from "./backupStore";
import type { ProfileStore } from "./profileStore";
import type { SettingsStore } from "./settingsStore";
import type { SkillLibraryStore } from "./skillLibraryStore";
import type { TargetDiscoveryService } from "./targetDiscovery";
import { SafeIdSchema } from "../shared/schemas";
import type { SaveProfileInput } from "../shared/types";
import type { TargetRegistry } from "./targets/registry";

export interface IpcServices {
  profileStore: ProfileStore;
  activationService: ActivationService;
  backupStore: BackupStore;
  settingsStore: SettingsStore;
  skillLibraryStore: SkillLibraryStore;
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
  settingsStore,
  skillLibraryStore,
  targetRegistry,
  targetDiscoveryService
}: IpcServices) => {
  ipcMain.handle("targets:list", () => targetDiscoveryService.listTargets());
  ipcMain.handle("skills:list-library", () => skillLibraryStore.listSkills());
  ipcMain.handle("skills:scan-unmanaged", () =>
    targetDiscoveryService
      .listTargets()
      .then((targets) => skillLibraryStore.scanUnmanaged(targets.map((target) => target.paths)))
  );
  ipcMain.handle("skills:import-library", (_event, sourcePath: unknown) =>
    skillLibraryStore.importSkill({ sourcePath: String(sourcePath) })
  );
  ipcMain.handle("skills:update-library", (_event, id: unknown) =>
    skillLibraryStore.updateSkill(parseId(id, "skill id"))
  );
  ipcMain.handle("settings:read", () => settingsStore.readSettings());
  ipcMain.handle("settings:update", (_event, input: unknown) =>
    settingsStore.updateSettings(input && typeof input === "object" ? input : {})
  );
  ipcMain.handle("profiles:list", () => profileStore.listProfiles());
  ipcMain.handle("profiles:read", (_event, id: unknown) =>
    profileStore.readProfile(parseId(id, "profile id"))
  );
  ipcMain.handle("profiles:save", (_event, input: SaveProfileInput) =>
    profileStore.saveProfile(input)
  );
  ipcMain.handle("profiles:create", (_event, targetId: unknown) =>
    profileStore.createProfile(parseId(targetId, "target id"))
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
