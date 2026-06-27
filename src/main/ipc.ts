import { ipcMain } from "electron";
import type { ActivationService } from "./activationService";
import type { BackupStore } from "./backupStore";
import type { ProfileStore } from "./profileStore";
import { SafeIdSchema } from "../shared/schemas";
import type { SaveProfileInput } from "../shared/types";
import type { TargetRegistry } from "./targets/registry";

export interface IpcServices {
  profileStore: ProfileStore;
  activationService: ActivationService;
  backupStore: BackupStore;
  targetRegistry: TargetRegistry;
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
  targetRegistry
}: IpcServices) => {
  ipcMain.handle("targets:list", () => targetRegistry.list());
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
