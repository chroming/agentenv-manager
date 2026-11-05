import { BrowserWindow, dialog } from "electron";
import { z } from "zod";
import type { WorktreeCleanupPreview, WorktreeOperationProgress, WorktreeScanResult } from "../../shared/worktrees";
import type { IpcRegistrationHandles } from "../ipc/registration";
import { WorktreeScanCancelledError, type WorktreeService } from "./worktreeService";
import type { RuntimeDiagnostics } from "../runtimeDiagnostics";
import { readAdvisory } from "../advisoryRead";

export const registerWorktreeIpc = (
  { diagnosticHandle, handleMutation }: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  service: WorktreeService,
  diagnostics?: Pick<RuntimeDiagnostics, "record">
) => {
  const removals = new Map<string, { controller: AbortController; sender: Electron.WebContents }>();
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
  diagnosticHandle("worktrees:cancel-remove", (event, id: unknown) => {
    const removal = removals.get(z.string().uuid().parse(id));
    if (!removal || removal.sender !== event.sender) return false;
    removal.controller.abort();
    return true;
  });
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
    const controller = new AbortController();
    if (requestId) removals.set(requestId, { controller, sender: event.sender });
    const operationStarted = performance.now();
    const logs = new Set<Promise<unknown>>();
    let previous: WorktreeOperationProgress["phase"] = "preparing", started = operationStarted, lastLogged = started;
    let latest: WorktreeOperationProgress["fileProgress"];
    const recordStage = (phase: string, durationMs?: number) => {
      const pending = diagnostics?.record("worktrees:remove", phase, {
        ...(durationMs === undefined ? {} : { durationMs }), context: { stage: previous, path: preview.entry.path }
      }).catch(() => undefined);
      if (pending) { logs.add(pending); void pending.then(() => logs.delete(pending)); }
    };
    const finishStage = () => {
      recordStage("stage-finished", Math.round(performance.now() - started));
    };
    recordStage("stage-started");
    const heartbeat = setInterval(() => {
      const now = performance.now();
      if (requestId) sendProgress(event, { requestId, phase: previous, path: preview.entry.path, completed: 0, total: 1,
        elapsedMs: Math.round(now - operationStarted), ...(latest ? { fileProgress: latest } : {}) });
      if (now - lastLogged >= 15_000) { recordStage("stage-running", Math.round(now - started)); lastLogged = now; }
    }, 1000);
    heartbeat.unref?.();
    try {
      const result = await service.remove(preview, (phase, fileProgress) => {
        if (previous !== phase) {
          finishStage(); previous = phase; started = performance.now(); lastLogged = started; recordStage("stage-started");
        }
        latest = fileProgress;
        if (requestId) sendProgress(event, { requestId, phase, path: preview.entry.path, completed: 0, total: 1,
          ...(fileProgress ? { fileProgress } : {}) });
      }, controller.signal);
      const warnings = result.verificationWarnings;
      if (warnings?.length && diagnostics) {
        const reference = await readAdvisory(() => diagnostics.record("worktrees:remove", result.timedOut ? "cleanup-timed-out" : "cleanup-completed-with-notes", {
          outcome: "partial", error: new Error(warnings.join("\n")),
          context: { path: result.path, mode: result.mode, disposalId: result.id, pendingGitCleanup: result.pendingGitCleanup, timedOut: result.timedOut }
        }), 150);
        if (reference.available) return { ...result, verificationWarnings: warnings.map((warning) => `${warning}\nDiagnostic reference: ${reference.value}`) };
      }
      return result;
    } finally {
      if (requestId) removals.delete(requestId);
      clearInterval(heartbeat); finishStage();
      await readAdvisory(() => Promise.allSettled([...logs]), 150);
    }
  });
  handleMutation("worktrees:restore", (_event, id: unknown) => service.restore(String(id)));
};
