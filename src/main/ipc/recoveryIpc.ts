import { BrowserWindow, dialog, shell } from "electron";
import type { ActivationService } from "../activationService";
import type { BackupMaintenanceService } from "../backupMaintenanceService";
import type { BackupStore } from "../backupStore";
import { createDataBackup, inspectDataBackup, restoreDataBackup } from "../dataBackupService";
import type { MutationCoordinator } from "../mutationCoordinator";
import type { AgentEnvPaths } from "../paths";
import type { DeleteManagedBackupInput } from "../../shared/types";
import { parseId, type IpcRegistrationHandles } from "./registration";

const parseManagedBackupInput = (value: unknown): DeleteManagedBackupInput => {
  if (!value || typeof value !== "object") throw new Error("Invalid backup selection");
  const input = value as { id?: unknown; kind?: unknown };
  if (input.kind !== "target-recovery" && input.kind !== "skill-cleanup" && input.kind !== "workspace-sync") {
    throw new Error("Invalid backup kind");
  }
  return { id: parseId(input.id, "backup id"), kind: input.kind };
};

interface RecoveryIpcServices {
  activationService: ActivationService;
  backupMaintenanceService: BackupMaintenanceService;
  backupStore: BackupStore;
  mutationCoordinator: MutationCoordinator;
  paths: AgentEnvPaths;
}

export const registerRecoveryIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  services: RecoveryIpcServices
) => {
  const { diagnosticHandle, handleMutation } = handles;
  const { activationService, backupMaintenanceService, backupStore, mutationCoordinator, paths } = services;
  diagnosticHandle("backups:list", () => backupStore.listBackups());
  diagnosticHandle("backups:list-managed", () => backupMaintenanceService.listInventory());
  diagnosticHandle("backups:preview-managed", (_event, input: unknown) =>
    backupMaintenanceService.previewBackup(parseManagedBackupInput(input))
  );
  handleMutation("backups:delete-managed", (_event, input: unknown) =>
    backupMaintenanceService.deleteBackup(parseManagedBackupInput(input))
  );
  handleMutation("backups:cleanup-managed", () => backupMaintenanceService.cleanup());
  diagnosticHandle("rollback:preview", (_event, backupId: unknown) => activationService.previewRollback(String(backupId)));
  handleMutation("rollback:apply", (_event, backupId: unknown) => activationService.rollback(String(backupId)));
  diagnosticHandle("targets:preview-stop-managing", (_event, targetId: unknown, mode: unknown) =>
    activationService.previewStopManaging(
      parseId(targetId, "target id"),
      mode === "restore-pre-takeover" ? "restore-pre-takeover" : "keep-current"
    )
  );
  handleMutation("targets:stop-managing", (_event, previewId: unknown) => activationService.stopManaging(String(previewId)));
  diagnosticHandle("data:create-backup", async () => {
    const owner = BrowserWindow.getFocusedWindow();
    const options = {
      title: "Choose AgentEnv backup location",
      buttonLabel: "Create backup here",
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    const destination = result.filePaths[0];
    return result.canceled || !destination
      ? undefined
      : mutationCoordinator.runExclusive("data:create-backup", () => createDataBackup(paths, destination));
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
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    return result.canceled || !selected ? undefined : inspectDataBackup(selected);
  });
  handleMutation("data:restore", (_event, path: unknown) => restoreDataBackup(paths, String(path)));
  handleMutation("targets:adopt-changes", (_event, profileId: unknown, targetId: unknown) =>
    activationService.adoptTargetChanges(
      parseId(profileId, "profile id"),
      parseId(targetId, "target id")
    )
  );
};
