import { BrowserWindow, dialog } from "electron";
import { z } from "zod";
import type { WorktreeCleanupPreview, WorktreeOperationProgress, WorktreeScanResult } from "../../shared/worktrees";
import type { IpcRegistrationHandles } from "../ipc/registration";
import { WorktreeScanCancelledError, type WorktreeService } from "./worktreeService";
import type { RuntimeDiagnostics } from "../runtimeDiagnostics";

export const registerWorktreeIpc = (
  { diagnosticHandle, handleMutation }: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  service: WorktreeService,
  diagnostics?: Pick<RuntimeDiagnostics, "record">
) => {
  const sendProgress = (event: Electron.IpcMainInvokeEvent, value: WorktreeOperationProgress) => {
    try { if (!event.sender.isDestroyed()) event.sender.send("worktrees:progress", value); }
    catch { /* A closing renderer cannot fail a local operation. */ }
  };
  service.onInventoryChanged((inventory) => {
    for (const window of BrowserWindow.getAllWindows()) {
      try { if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("worktrees:inventory-changed", inventory); }
      catch { /* Windows may close while read-only metrics finish. */ }
    }
  });
  diagnosticHandle("worktrees:cached-inventory", () => service.cachedInventory());
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
  diagnosticHandle("worktrees:inventory", async (_event, mode?: unknown): Promise<WorktreeScanResult> => {
    try {
      return await service.inventory(mode === "background" ? "background" : undefined);
    } catch (error) {
      if (error instanceof WorktreeScanCancelledError) return { cancelled: true };
      throw error;
    }
  });
  diagnosticHandle("worktrees:cancel-scan", () => service.cancelScan());
  diagnosticHandle("worktrees:preview", (_event, commonDir: unknown, path: unknown, allowDirty: unknown, mode: unknown) =>
    service.preview(String(commonDir), String(path), allowDirty === true, z.enum(["trash", "permanent"]).default("trash").parse(mode)));
  diagnosticHandle("worktrees:preview-trash-deletion", (_event, id: unknown) => service.previewTrashDeletion(z.string().uuid().parse(id)));
  diagnosticHandle("worktrees:preview-batch", async (event, raw, id) => {
    const requestId = z.string().uuid().parse(id);
    const items = z.array(z.object({ commonDir: z.string().min(1), path: z.string().min(1), allowDirty: z.boolean(), mode: z.enum(["trash", "permanent"]).default("trash") })).max(1000).parse(raw);
    const results = await service.previewBatch(items, (completed, path, preparation) => {
      sendProgress(event, { requestId, phase: "preparing", path, completed, total: items.length,
        ...(preparation ? { preparation } : {}) });
    });
    const failures = results.filter((item) => item.error !== undefined);
    const reference = await diagnostics?.record("worktrees:preview-batch", "prepared-worktrees", {
      outcome: failures.length ? failures.length === results.length ? "failed" : "partial" : "completed",
      ...(failures.length ? { error: new Error(failures.map((item) => `${item.path}: ${item.error}`).join("\n")) } : {}),
      context: {
      count: items.length, ready: results.filter((item) => item.preview).length,
      failures: failures.map((item) => ({ path: item.path, error: item.error }))
    } }).catch(() => undefined);
    return results.map((item) => item.error !== undefined && reference ? { ...item, error: `${item.error}\nDiagnostic reference: ${reference}` } : item);
  });
  diagnosticHandle("worktrees:list-recovery", (_event, scope: unknown) => service.listRecovery(z.enum(["trash", "all"]).optional().parse(scope)));
  handleMutation("worktrees:add-root", (_event, path: unknown) => service.addScanRoot(String(path)));
  handleMutation("worktrees:remove-root", (_event, path: unknown) => service.removeScanRoot(String(path)));
  handleMutation("worktrees:set-keep", (_event, commonDir: unknown, path: unknown, reason: unknown) =>
    service.setKeep(String(commonDir), String(path), reason === undefined ? undefined : String(reason)));
  handleMutation("worktrees:set-repository-keep", (_event, commonDir: unknown, reason: unknown) =>
    service.setRepositoryKeep(String(commonDir), reason === undefined ? undefined : String(reason)));
  handleMutation("worktrees:set-integration-ref", (_event, commonDir: unknown, ref: unknown) =>
    service.setIntegrationRef(String(commonDir), ref === undefined ? undefined : String(ref)));
  handleMutation("worktrees:remove", async (event, preview: WorktreeCleanupPreview, id) => {
    const requestId = id === undefined ? undefined : z.string().uuid().parse(id);
    let previous: string | undefined, started = performance.now();
    const logs: Promise<unknown>[] = [];
    const finishStage = () => {
      if (previous && diagnostics) logs.push(diagnostics.record("worktrees:remove", "stage-finished", {
        durationMs: Math.round(performance.now() - started), context: { stage: previous, path: preview.entry.path }
      }).catch(() => undefined));
    };
    try {
      const result = await service.remove(preview, (phase, fileProgress) => {
        if (previous !== phase) { finishStage(); previous = phase; started = performance.now(); }
        if (requestId) sendProgress(event, { requestId, phase, path: preview.entry.path, completed: 0, total: 1,
          ...(fileProgress ? { fileProgress } : {}) });
      });
      if (result.verificationWarnings?.length && diagnostics) {
        const reference = await diagnostics.record("worktrees:remove", "cleanup-completed-with-notes", {
          outcome: "partial", error: new Error(result.verificationWarnings.join("\n")),
          context: { path: result.path, mode: result.mode, disposalId: result.id, pendingGitCleanup: result.pendingGitCleanup }
        }).catch(() => undefined);
        if (reference) return { ...result, verificationWarnings: result.verificationWarnings.map((warning) => `${warning}\nDiagnostic reference: ${reference}`) };
      }
      return result;
    } finally { finishStage(); await Promise.allSettled(logs); }
  });
  handleMutation("worktrees:restore", (_event, id: unknown) => service.restore(String(id)));
};
