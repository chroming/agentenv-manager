import { BrowserWindow, dialog } from "electron";
import type { WorktreeCleanupPreview } from "../../shared/worktrees";
import type { IpcRegistrationHandles } from "../ipc/registration";
import type { WorktreeService } from "./worktreeService";

export const registerWorktreeIpc = (
  { diagnosticHandle, handleMutation }: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  service: WorktreeService
) => {
  diagnosticHandle("dialog:select-worktree-scan-root", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Choose a worktree scan location",
      buttonLabel: "Add location",
      properties: ["openDirectory"]
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  diagnosticHandle("worktrees:inventory", () => service.inventory());
  diagnosticHandle("worktrees:cancel-scan", () => service.cancelScan());
  diagnosticHandle("worktrees:preview", (_event, commonDir: unknown, path: unknown, allowDirty: unknown) =>
    service.preview(String(commonDir), String(path), allowDirty === true));
  diagnosticHandle("worktrees:list-recovery", () => service.listRecovery());
  handleMutation("worktrees:add-root", (_event, path: unknown) => service.addScanRoot(String(path)));
  handleMutation("worktrees:remove-root", (_event, path: unknown) => service.removeScanRoot(String(path)));
  handleMutation("worktrees:set-keep", (_event, commonDir: unknown, path: unknown, reason: unknown) =>
    service.setKeep(String(commonDir), String(path), reason === undefined ? undefined : String(reason)));
  handleMutation("worktrees:remove", (_event, preview: WorktreeCleanupPreview) => service.remove(preview));
  handleMutation("worktrees:restore", (_event, id: unknown) => service.restore(String(id)));
};
