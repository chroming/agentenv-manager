import {
  AlertTriangle, ArrowLeft, Check, CircleStop, Copy, FolderGit2, GitBranch,
  History, LoaderCircle, LockKeyhole, Maximize2, Minimize2, Plus,
  RefreshCw, RotateCcw, Trash2, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WorktreeCleanupPreview, WorktreeEntry, WorktreeInventory, WorktreeRecoveryRecord
} from "../../shared/worktrees";
import { formatBytes } from "../formatBytes";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  Badge, Button, ChoiceInput, ControlGroup, DialogBody, DialogFooter, DialogHeader,
  EmptyState, IconButton, ModalFrame, Notice, PageHeader, ResourceRow, TabBar
} from "./ui";

const entryKey = (entry: WorktreeEntry) => `${entry.commonDir}\0${entry.path}`;
const nameFromPath = (path: string) => path.replace(/[\\/]$/, "").split(/[\\/]/).at(-1) ?? path;

export const WorktreeDialog = ({ open, onClose, presentation = "dialog" }: {
  open: boolean; onClose(): void; presentation?: "dialog" | "page";
}) => {
  const { t, formatDate } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [inventory, setInventory] = useState<WorktreeInventory>();
  const [recovery, setRecovery] = useState<WorktreeRecoveryRecord[]>([]);
  const [recoveryIssues, setRecoveryIssues] = useState<string[]>([]);
  const [view, setView] = useState<"list" | "detail" | "confirm" | "results" | "recovery">("list");
  const [detail, setDetail] = useState<WorktreeEntry>();
  const [manualConfirm, setManualConfirm] = useState(false);
  const [previews, setPreviews] = useState<WorktreeCleanupPreview[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [filter, setFilter] = useState<"all" | "review" | "kept">("all");

  useModalDialog({ open: open && presentation === "dialog", dialogRef, initialFocusRef: closeRef, onDismiss: onClose, dismissDisabled: Boolean(busy) && busy !== "scan" });

  const refresh = async () => {
    setBusy("scan");
    setError("");
    setSelected([]);
    try {
      setInventory(await window.agentEnv.inventoryWorktrees());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    if (!open) return;
    setView("list");
    void refresh();
    return () => { void window.agentEnv.cancelWorktreeScan(); };
  }, [open]);

  const entriesByRepo = useMemo(() => {
    const groups = new Map<string, WorktreeEntry[]>();
    for (const entry of inventory?.entries ?? []) {
      if (filter === "review" && (entry.main || entry.keptReason || !["candidate", "review"].includes(entry.state))) continue;
      if (filter === "kept" && entry.state !== "kept") continue;
      const rows = groups.get(entry.commonDir) ?? [];
      rows.push(entry);
      groups.set(entry.commonDir, rows);
    }
    return [...groups].sort((a, b) => a[1][0].repositoryPath.localeCompare(b[1][0].repositoryPath));
  }, [inventory, filter]);

  const addLocation = async () => {
    setError("");
    try {
      const path = await window.agentEnv.selectWorktreeScanRoot();
      if (!path) return;
      setBusy("location");
      await window.agentEnv.addWorktreeScanRoot(path);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  const removeLocation = async (path: string) => {
    setBusy("location");
    setError("");
    try {
      await window.agentEnv.removeWorktreeScanRoot(path);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  const setKeep = async (entry: WorktreeEntry) => {
    setBusy("keep");
    setError("");
    try {
      await window.agentEnv.setWorktreeKeep(
        entry.commonDir, entry.path, entry.keptReason ? undefined : "Kept by user"
      );
      setView("list");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  const prepare = async (entries: WorktreeEntry[], allowDirty = false) => {
    setBusy("preview");
    setError("");
    const ready: WorktreeCleanupPreview[] = [];
    const failures: string[] = [];
    for (const entry of entries) {
      try {
        ready.push(await window.agentEnv.previewWorktreeCleanup(entry.commonDir, entry.path, allowDirty));
      } catch (cause) {
        failures.push(`${entry.path}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    setPreviews(ready);
    setBusy("");
    if (failures.length) setError(failures.join("\n"));
    if (ready.length) setView("confirm");
  };
  const clean = async () => {
    setBusy("remove");
    setError("");
    const completed: string[] = [];
    for (const preview of previews) {
      try {
        await window.agentEnv.removeWorktree(preview);
        completed.push(`${t("Removed")}: ${preview.entry.path}`);
      } catch (cause) {
        completed.push(`${t("Skipped")}: ${preview.entry.path} — ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      setResults([...completed]);
    }
    setSelected([]);
    setView("results");
    await refresh();
    setBusy("");
  };
  const showRecovery = async () => {
    setBusy("recovery");
    setError("");
    try {
      const latest = await window.agentEnv.listWorktreeRecovery();
      setRecovery(latest.records);
      setRecoveryIssues(latest.issues);
      setView("recovery");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  const restore = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await window.agentEnv.restoreWorktree(id);
      const latest = await window.agentEnv.listWorktreeRecovery();
      setRecovery(latest.records);
      setRecoveryIssues(latest.issues);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  if (!open) return null;

  const title = view === "recovery" ? t("Worktree recovery") : t("Worktrees");
  const recoveryLabel = (status: WorktreeRecoveryRecord["status"]) => {
    switch (status) {
      case "removed": return t("Removed");
      case "restored": return t("Restored");
      case "unchanged": return t("Unchanged");
      case "prepared": return t("Prepared");
    }
  };
  const content = (
    <>
      {presentation === "page" ? <PageHeader
        title={title}
        className="worktree-workspace__header"
        navigation={view === "list" ? <TabBar<"all" | "review" | "kept"> label={t("Worktree filter")} value={filter} onChange={(value) => { setFilter(value); setSelected([]); }}
          options={[
            { value: "all", label: t("All") },
            { value: "review", label: t("Review") },
            { value: "kept", label: t("Kept") }
          ]} /> : <Button size="compact" icon={<ArrowLeft size={15} />} onClick={() => setView("list")}>{t("Worktrees")}</Button>}
        actions={view === "list" ? <ControlGroup>
          {selected.length ? <Button size="compact" disabled={Boolean(busy)} onClick={() => void prepare((inventory?.entries ?? []).filter((entry) => selected.includes(entryKey(entry))))}>{t("Review selected")} ({selected.length})</Button> : null}
          <IconButton label={t("Add location")} variant="ghost" disabled={Boolean(busy)} onClick={() => void addLocation()}><Plus size={16} /></IconButton>
          {busy === "scan" ? <IconButton label={t("Stop scanning")} variant="ghost" onClick={() => void window.agentEnv.cancelWorktreeScan()}><CircleStop size={16} /></IconButton>
            : <IconButton label={t("Refresh Worktrees")} variant="ghost" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={16} /></IconButton>}
          <IconButton label={t("Worktree recovery")} variant="ghost" disabled={Boolean(busy)} onClick={() => void showRecovery()}><History size={16} /></IconButton>
        </ControlGroup> : undefined}
      /> : <DialogHeader
        title={title}
        description={view === "list" ? t("Working directories found in your local scan locations") : undefined}
        actions={<ControlGroup>
          {view !== "list" ? <IconButton label={t("Back to Worktrees")} variant="ghost" onClick={() => setView("list")}><ArrowLeft size={16} /></IconButton> : null}
          <IconButton label={maximized ? t("Restore window size") : t("Maximize window")} variant="ghost" onClick={() => setMaximized(!maximized)}>
            {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </IconButton>
          <IconButton ref={closeRef} label={t("Close")} variant="ghost" disabled={Boolean(busy) && busy !== "scan"} onClick={onClose}><X size={16} /></IconButton>
        </ControlGroup>}
      />}
      <DialogBody className="worktree-dialog__body">
        {error ? <Notice tone="danger" icon={<AlertTriangle size={15} />} role="alert">{error}</Notice> : null}
        {view === "list" ? <>
          {presentation === "dialog" ? <div className="worktree-dialog__toolbar">
            <ControlGroup>
              <Button size="compact" icon={<Plus size={14} />} onClick={() => void addLocation()} disabled={Boolean(busy)}>{t("Add location")}</Button>
              {busy === "scan" ? <IconButton label={t("Stop scanning")} variant="ghost" onClick={() => void window.agentEnv.cancelWorktreeScan()}><CircleStop size={15} /></IconButton>
                : <IconButton label={t("Refresh Worktrees")} variant="ghost" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={15} /></IconButton>}
            </ControlGroup>
            <ControlGroup>
              <Button size="compact" disabled={!selected.length || Boolean(busy)} onClick={() => void prepare((inventory?.entries ?? []).filter((entry) => selected.includes(entryKey(entry))))}>
                {t("Review selected")} {selected.length ? `(${selected.length})` : ""}
              </Button>
              <IconButton label={t("Worktree recovery")} variant="ghost" disabled={Boolean(busy)} onClick={() => void showRecovery()}><History size={15} /></IconButton>
            </ControlGroup>
          </div> : null}
          {inventory?.scanRoots.length ? <details className="worktree-dialog__scope">
            <summary>{t("Scan locations")} · {inventory.scanRoots.length}</summary>
            <div className="worktree-dialog__locations">
              {inventory.scanRoots.map((path) => <span className="worktree-dialog__location" key={path}>
                <span className="selectable" title={path}>{path}</span>
                <small>{inventory.configuredRoots.includes(path) ? t("Added location") : inventory.builtinRoots.includes(path) ? t("Common location") : t("From a saved Workspace")}</small>
                {inventory.configuredRoots.includes(path) ? <IconButton label={t("Remove scan location")} variant="ghost" disabled={Boolean(busy)} onClick={() => void removeLocation(path)}><X size={13} /></IconButton> : null}
              </span>)}
            </div>
          </details> : null}
          {inventory?.issues.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />} role="status">
            {t("Some locations could not be fully scanned")}
            <span className="selectable" title={inventory.issues.join("\n")}>{inventory.issues[0]}</span>
          </Notice> : null}
          {busy === "scan" ? <span className="worktree-dialog__working"><LoaderCircle className="is-spinning" size={15} />{t("Scanning Worktrees...")}</span> : null}
          {entriesByRepo.length === 0 && busy !== "scan" ? <EmptyState icon={<FolderGit2 size={25} />} title={t("No Worktrees found")} description={filter === "all" ? t("Add a scan location to look for local Git working directories.") : undefined} /> : null}
          {entriesByRepo.map(([commonDir, entries]) => <section className="worktree-dialog__group" key={commonDir}>
            <div className="worktree-dialog__group-title"><GitBranch size={15} /><span className="selectable" title={entries[0].repositoryPath}>{entries[0].repositoryPath}</span><span>{entries.length}</span></div>
            {entries.map((entry) => <ResourceRow
              key={entryKey(entry)} density="compact" icon={entry.locked ? <LockKeyhole size={16} /> : <FolderGit2 size={16} />}
              title={<span title={entry.path}>{nameFromPath(entry.path)}</span>}
              description={<span className="selectable" title={entry.path}>{entry.path}</span>}
              metadata={entry.branch ?? (entry.detached ? t("Detached HEAD") : entry.head?.slice(0, 8))}
              state={<Badge tone={entry.state === "review" ? "warning" : "neutral"} title={entry.reasons.join("\n")}>
                {entry.main ? t("Main") : entry.state === "candidate" ? t("Review clean") : entry.state === "kept" ? t("Kept") : entry.state === "review" ? t("Needs review") : t("Unavailable")}
              </Badge>}
              actions={<ControlGroup>
                {entry.cleanupReviewAvailable && !entry.keptReason ? <ChoiceInput
                  type="checkbox" aria-label={t("Select Worktree for review")}
                  checked={selected.includes(entryKey(entry))}
                  onChange={(event) => setSelected((current) => event.target.checked ? [...current, entryKey(entry)] : current.filter((key) => key !== entryKey(entry)))}
                /> : null}
                <Button size="compact" disabled={Boolean(busy)} onClick={() => { setDetail(entry); setManualConfirm(false); setView("detail"); }}>{t("Review")}</Button>
              </ControlGroup>}
            />)}
          </section>)}
        </> : null}
        {view === "detail" && detail ? <div className="worktree-dialog__detail">
          <h3>{nameFromPath(detail.path)}</h3>
          <p className="selectable">{detail.path}</p>
          <p>{detail.branch ?? (detail.detached ? t("Detached HEAD") : detail.head?.slice(0, 8))} · {detail.head?.slice(0, 12)}</p>
          <p>{t("Local files")}: {detail.sizeBytes === undefined ? t("Unavailable") : formatBytes(detail.sizeBytes)}
            {detail.modifiedAt ? ` · ${t("Last modified")} ${formatDate(detail.modifiedAt)}` : ""}</p>
          {detail.manualReviewAvailable ? <p>{t("Review whether this work is complete. MR status and squash integration are not verified automatically.")}</p> : null}
          {detail.reasons.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>{detail.reasons.join(" · ")}</Notice> : <Notice tone="info" icon={<Check size={15} />}>{t("No local file changes found. Review the purpose of this worktree before removing it.")}</Notice>}
          {detail.changes.length ? <section><h4>{t("Changed and untracked paths")} ({detail.changes.length})</h4><pre className="selectable">{detail.changes.join("\n")}</pre></section> : null}
          {detail.ignored.length ? <section><h4>{t("Ignored paths")} ({detail.ignored.length})</h4><pre className="selectable">{detail.ignored.join("\n")}</pre></section> : null}
          {detail.manualReviewAvailable && !detail.cleanupReviewAvailable && !detail.keptReason ? <label className="worktree-dialog__confirmation">
            <ChoiceInput type="checkbox" checked={manualConfirm} onChange={(event) => setManualConfirm(event.target.checked)} />
            <span>{t("I reviewed this worktree and want to remove its local contents after a verified recovery copy is saved.")}</span>
          </label> : null}
          <Button size="compact" icon={<Copy size={14} />} onClick={() => void window.agentEnv.copyText(detail.path)}>{t("Copy path")}</Button>
        </div> : null}
        {view === "confirm" ? <div className="worktree-dialog__detail">
          <h3>{previews.length === 1 ? t("Remove this Worktree?") : t("Remove {{count}} Worktrees?", { count: previews.length })}</h3>
          <p>{t("Only working directories are removed. Git commits are retained; local-only files receive a verified recovery copy first.")}</p>
          <p>{t("Confirm each selected task is finished; code integration is not inferred from commit IDs.")}</p>
          {previews.some((preview) => preview.savedWorkspace) ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("A saved Workspace points to a selected Worktree. Its shortcut will remain, but the folder will be unavailable after removal.")}
          </Notice> : null}
          {previews.some((preview) => preview.forceRequired) ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("These worktrees contain local files. Git will force-remove only the reviewed paths after their recovery copies are verified.")}
            <br />{t("Recovery copies of local-only files remain in AgentEnv data and may still use disk space.")}
          </Notice> : null}
          {previews.map((preview) => <ResourceRow key={entryKey(preview.entry)} icon={<FolderGit2 size={16} />} title={nameFromPath(preview.entry.path)} description={<span className="selectable">{preview.entry.path}</span>} metadata={preview.entry.branch ?? preview.entry.head?.slice(0, 8)} />)}
        </div> : null}
        {view === "results" ? <div className="worktree-dialog__detail">
          <h3>{t("Cleanup results")}</h3>
          {results.map((result) => <p className="selectable" key={result}>{result}</p>)}
        </div> : null}
        {view === "recovery" ? <div className="worktree-dialog__detail">
          {recoveryIssues.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("Some recovery records need review")}
            <span className="selectable">{recoveryIssues.join("\n")}</span>
          </Notice> : null}
          {recovery.length === 0 ? <EmptyState icon={<History size={25} />} title={t("No Worktree recovery points")} /> : null}
          {recovery.map((item) => <ResourceRow key={item.id} icon={<History size={16} />} title={nameFromPath(item.path)} description={<span className="selectable">{item.path}</span>} metadata={formatDate(item.createdAt)} state={<Badge>{recoveryLabel(item.status)}</Badge>} actions={<Button size="compact" icon={<RotateCcw size={14} />} busy={busy === item.id} disabled={Boolean(busy) || item.status === "restored" || item.status === "unchanged"} onClick={() => void restore(item.id)}>{t("Restore")}</Button>} />)}
        </div> : null}
      </DialogBody>
      {view !== "list" || presentation === "dialog" ? <DialogFooter>
        {view === "confirm" ? <>
          <Button disabled={Boolean(busy)} onClick={() => setView("list")}>{t("Cancel")}</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} busy={busy === "remove"} disabled={Boolean(busy)} onClick={() => void clean()}>{previews.length === 1 ? t("Remove Worktree") : t("Remove Worktrees")}</Button>
        </> : view === "detail" && detail ? <>
          {!detail.main ? <Button size="compact" busy={busy === "keep"} disabled={Boolean(busy)} onClick={() => void setKeep(detail)}>{detail.keptReason ? t("Remove keep marker") : t("Keep Worktree")}</Button> : null}
          {detail.manualReviewAvailable && !detail.keptReason ? <Button variant="danger" disabled={Boolean(busy) || (!detail.cleanupReviewAvailable && !manualConfirm)} busy={busy === "preview"} onClick={() => void prepare([detail], !detail.cleanupReviewAvailable)}>{t("Review cleanup")}</Button> : null}
        </> : <Button onClick={view === "list" ? onClose : () => setView("list")}>{view === "list" ? t("Close") : t("Back")}</Button>}
      </DialogFooter> : null}
    </>
  );
  if (presentation === "page") return <section className="worktree-workspace" aria-label={title}>{content}</section>;
  return (
    <ModalFrame
      ariaLabel={title}
      className="worktree-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={Boolean(busy) && busy !== "scan"}
      maximized={maximized}
      size="wide"
      onDismiss={onClose}
    >
      {content}
    </ModalFrame>
  );
};

export const WorktreeWorkspace = () => (
  <WorktreeDialog open onClose={() => undefined} presentation="page" />
);
