import {
  AlertTriangle, ArrowLeft, Check, CircleStop, Copy, FolderGit2, GitBranch,
  FolderSearch, History, LoaderCircle, LockKeyhole, Maximize2, Minimize2, Plus,
  RotateCcw, Search, Trash2, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  WorktreeCleanupPreview, WorktreeEntry, WorktreeInventory, WorktreeRecoveryRecord
} from "../../shared/worktrees";
import type { UiState, UiStateUpdate, WorktreeSort } from "../../shared/uiState";
import { sortWorktreeGroups, worktreeName } from "../worktreeSort";
import { formatBytes } from "../formatBytes";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  AlignedResourceList, Badge, Button, ChoiceInput, ControlGroup, DetailList,
  DiagnosticMessage, DialogBody, DialogFooter, DialogHeader, EmptyState, IconButton,
  InteractiveStatus, ModalFrame, Notice, OperationStatusBar, PageHeader, PathListPreview, RefreshAction, ResourceRow, SectionLabel,
  SearchField, SortMenu, TabBar, TextAction
} from "./ui";

const entryKey = (entry: WorktreeEntry) => `${entry.commonDir}\0${entry.path}`;
const nameFromPath = worktreeName;

interface WorktreeSortPreference {
  uiState?: Pick<UiState, "worktreeSort">;
  onUpdateUiState?(update: UiStateUpdate): void;
}

export const WorktreeDialog = ({ open, onClose, presentation = "dialog", uiState, onUpdateUiState }: {
  open: boolean; onClose(): void; presentation?: "dialog" | "page";
} & WorktreeSortPreference) => {
  const { t, formatDate } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scanRequest = useRef(0);
  const [inventory, setInventory] = useState<WorktreeInventory>();
  const [recovery, setRecovery] = useState<WorktreeRecoveryRecord[]>([]);
  const [recoveryIssues, setRecoveryIssues] = useState<string[]>([]);
  const [view, setView] = useState<"list" | "locations" | "detail" | "confirm" | "results" | "recovery">("list");
  const [detail, setDetail] = useState<WorktreeEntry>();
  const [manualConfirm, setManualConfirm] = useState(false);
  const [previews, setPreviews] = useState<WorktreeCleanupPreview[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Array<{ path: string; error?: string }>>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [filter, setFilter] = useState<"all" | "review" | "kept">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WorktreeSort>(uiState?.worktreeSort ?? "name");
  useEffect(() => setSort(uiState?.worktreeSort ?? "name"), [uiState?.worktreeSort]);
  const dismissReview = () => { setView("list"); setError(""); setMaximized(false); };
  const dismiss = presentation === "dialog" ? onClose : dismissReview;

  useModalDialog({ open: open && (presentation === "dialog" || view !== "list"), dialogRef, initialFocusRef: closeRef, focusKey: view, onDismiss: dismiss, dismissDisabled: Boolean(busy) && busy !== "scan" });

  const refresh = async (visible = true) => {
    const request = ++scanRequest.current;
    if (visible) { setBusy("scan"); setError(""); }
    setSelected([]);
    try {
      const result = await window.agentEnv.inventoryWorktrees();
      if (request !== scanRequest.current) return;
      if (!("cancelled" in result)) setInventory(result);
    } catch (cause) {
      if (request === scanRequest.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (visible && request === scanRequest.current) setBusy("");
    }
  };
  useEffect(() => {
    if (!open) return;
    setView("list");
    void refresh();
    return () => {
      ++scanRequest.current;
      void window.agentEnv.cancelWorktreeScan();
    };
  }, [open]);

  const entriesByRepo = useMemo(() => {
    const groups = new Map<string, WorktreeEntry[]>();
    const needle = query.trim().toLocaleLowerCase();
    for (const entry of inventory?.entries ?? []) {
      if (needle && ![entry.path, entry.repositoryPath, entry.branch ?? ""].some((value) => value.toLocaleLowerCase().includes(needle))) continue;
      if (filter === "review" && (entry.main || entry.keptReason || !["candidate", "review"].includes(entry.state))) continue;
      if (filter === "kept" && entry.state !== "kept") continue;
      const rows = groups.get(entry.commonDir) ?? [];
      rows.push(entry);
      groups.set(entry.commonDir, rows);
    }
    return sortWorktreeGroups(
      [...groups].filter(([, rows]) => rows.some((entry) => !entry.main)), sort
    );
  }, [inventory, filter, query, sort]);

  const addLocation = async () => {
    setError("");
    try {
      const path = await window.agentEnv.selectWorktreeScanRoot();
      if (!path) return;
      setBusy("add-location");
      await window.agentEnv.addWorktreeScanRoot(path);
      await refresh(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  const removeLocation = async (path: string) => {
    setBusy(path);
    setError("");
    try {
      await window.agentEnv.removeWorktreeScanRoot(path);
      await refresh(false);
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
      dismissReview();
      await refresh(false);
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
    const completed: Array<{ path: string; error?: string }> = [];
    setResults([]);
    setView("results");
    for (const preview of previews) {
      try {
        await window.agentEnv.removeWorktree(preview);
        completed.push({ path: preview.entry.path });
      } catch (cause) {
        completed.push({ path: preview.entry.path, error: cause instanceof Error ? cause.message : String(cause) });
      }
      setResults([...completed]);
    }
    setSelected([]);
    setView("results");
    await refresh(false);
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
      await refresh(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  if (!open) return null;

  const title = view === "locations" ? t("Scan locations") : view === "detail" && detail
    ? nameFromPath(detail.path) : view === "confirm" ? (previews.length === 1 ? t("Remove this Worktree?") : t("Remove {{count}} Worktrees?", { count: previews.length }))
    : view === "results" ? t("Cleanup results") : view === "recovery" ? t("Worktree recovery") : t("Worktrees");
  const recoveryLabel = (status: WorktreeRecoveryRecord["status"]) => {
    switch (status) {
      case "removed": return t("Removed");
      case "restored": return t("Restored");
      case "unchanged": return t("Unchanged");
      case "prepared": return t("Cleanup interrupted");
      case "restoring": return t("Restore interrupted");
    }
  };
  const review = (entry: WorktreeEntry) => {
    setDetail(entry); setManualConfirm(false); setError(""); setView("detail");
  };
  const toolbar = <PageHeader
        title={t("Worktrees")}
        navigation={<ControlGroup className="worktree-workspace__filters"><TabBar<"all" | "review" | "kept"> label={t("Worktree filter")} value={filter} onChange={(value) => { setFilter(value); setSelected([]); }}
          options={[
            { value: "all", label: t("All") },
            { value: "review", label: t("Review") },
            { value: "kept", label: t("Kept") }
          ]} />
          <SearchField label={t("Search Worktrees")} placeholder={t("Search")} icon={<Search size={14} />} value={query} onChange={(event) => { setQuery(event.target.value); setSelected([]); }} />
        </ControlGroup>}
        actions={<ControlGroup>
          <SortMenu<WorktreeSort> label={t("Sort Worktrees")} value={sort} active={sort !== "name"}
            options={[
              { value: "name", label: t("Name") },
              { value: "modified-desc", label: t("Newest modified") },
              { value: "modified-asc", label: t("Oldest modified") },
              { value: "size-desc", label: t("Largest size") },
              { value: "status", label: t("Cleanup status") }
            ]} onChange={(value) => { setSort(value); onUpdateUiState?.({ worktreeSort: value }); }} />
          {selected.length ? <Button size="compact" icon={<Trash2 size={15} />} title={t("Review selected")} aria-label={`${t("Review selected")} (${selected.length})`} busy={busy === "preview"} disabled={Boolean(busy)} onClick={() => void prepare((inventory?.entries ?? []).filter((entry) => selected.includes(entryKey(entry))))}>{selected.length}</Button> : null}
          <IconButton label={t("Scan locations")} variant="ghost" disabled={Boolean(busy)} onClick={() => { setError(""); setView("locations"); }} title={inventory?.incomplete ? [t("Some locations could not be fully scanned"), ...inventory.issues].join("\n") : t("Scan locations")}>
            {inventory?.incomplete ? <AlertTriangle size={16} /> : <FolderSearch size={16} />}
          </IconButton>
          <RefreshAction label={t("Refresh Worktrees")} busy={busy === "scan"} disabled={Boolean(busy) && busy !== "scan"} onRefresh={() => void refresh()} />
          {busy === "scan" ? <IconButton label={t("Stop scanning")} variant="ghost" onClick={() => void window.agentEnv.cancelWorktreeScan()}><CircleStop size={16} /></IconButton> : null}
          <IconButton label={t("Worktree recovery")} variant="ghost" busy={busy === "recovery"} disabled={Boolean(busy)} onClick={() => void showRecovery()}><History size={16} /></IconButton>
        </ControlGroup>}
      />;
  const failure = error ? <Notice tone="danger" icon={<AlertTriangle size={15} />} role="alert"><DiagnosticMessage message={error} /></Notice> : null;
  const list = <>
          {view === "list" ? failure : null}
          {busy === "scan" && !inventory ? <EmptyState icon={<LoaderCircle className="is-spinning" size={25} />} title={t("Scanning Worktrees...")} /> : null}
          {entriesByRepo.length === 0 && busy !== "scan" ? <EmptyState icon={<FolderGit2 size={25} />}
            title={filter === "all" ? t("No Worktrees found") : filter === "review" ? t("No Worktrees to review") : t("No kept Worktrees")}
            description={filter === "all" ? t("Add a scan location to look for local Git working directories.") : undefined} /> : null}
          {entriesByRepo.map(([commonDir, entries]) => <section className="worktree-dialog__group" key={commonDir}>
            <SectionLabel className="worktree-dialog__group-title" tone="muted" icon={<GitBranch size={15} />} count={entries.length}><span className="selectable" title={entries[0].repositoryPath}>{nameFromPath(entries[0].repositoryPath)}</span></SectionLabel>
            <AlignedResourceList actionTrack="compact" className="worktree-dialog__entries">
            {entries.map((entry) => <ResourceRow
              key={entryKey(entry)} density="compact" appearance="plain" icon={entry.locked ? <LockKeyhole size={16} /> : <FolderGit2 size={16} />}
              title={<TextAction title={entry.path} onClick={() => review(entry)}>{nameFromPath(entry.path)}</TextAction>}
              description={<span className="selectable" title={entry.path}>{entry.path}</span>}
              metadata={<span title={entry.branch ?? entry.head}>{entry.branch ?? (entry.detached ? t("Detached HEAD") : entry.head?.slice(0, 8))}</span>}
              state={<InteractiveStatus size="metadata" tone={entry.state === "review" ? "warning" : "neutral"} title={entry.reasons.join("\n")} reviewLabel={t("Review {{name}}", { name: nameFromPath(entry.path) })} onReview={() => review(entry)}
                label={entry.main ? t("Main") : entry.state === "candidate" ? t("Clean") : entry.state === "kept" ? t("Kept") : entry.state === "review" ? t("Needs review") : t("Unavailable")} />}
              actions={<ControlGroup>
                {entry.cleanupReviewAvailable && !entry.keptReason ? <ChoiceInput
                  type="checkbox" aria-label={t("Select Worktree for review")}
                  disabled={Boolean(busy)}
                  checked={selected.includes(entryKey(entry))}
                  onChange={(event) => setSelected((current) => event.target.checked ? [...current, entryKey(entry)] : current.filter((key) => key !== entryKey(entry)))}
                /> : null}
              </ControlGroup>}
            />)}
            </AlignedResourceList>
          </section>)}
        </>;
  const reviewBody = <div className="worktree-dialog__detail">
        {failure}
        {view === "locations" ? <>
          <p>{t("Only these locations are scanned. Add a folder if a repository is missing.")}</p>
          <ControlGroup><Button size="compact" icon={<Plus size={15} />} busy={busy === "add-location"} disabled={Boolean(busy)} onClick={() => void addLocation()}>{t("Add location")}</Button></ControlGroup>
          {inventory?.issues.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />}><span className="selectable">{inventory.issues.join("\n")}</span></Notice> : null}
          <AlignedResourceList actionTrack="compact" className="worktree-dialog__locations">
            {inventory?.scanRoots.map((path) => <ResourceRow key={path} density="compact" appearance="plain" icon={<FolderSearch size={16} />} title={<span className="selectable" title={path}>{path}</span>}
              description={inventory.configuredRoots.includes(path) ? t("Added location") : inventory.builtinRoots.includes(path) ? t("Common location") : t("From a saved Workspace")}
              actions={inventory.configuredRoots.includes(path) ? <IconButton label={t("Remove scan location")} variant="ghost" busy={busy === path} disabled={Boolean(busy)} onClick={() => void removeLocation(path)}><X size={15} /></IconButton> : undefined} />)}
          </AlignedResourceList>
        </> : null}
        {view === "detail" && detail ? <>
          <DetailList items={[
            { label: t("Folder"), value: detail.path, action: <IconButton label={t("Copy path")} variant="ghost" onClick={() => void window.agentEnv.copyText(detail.path)}><Copy size={15} /></IconButton> },
            { label: t("Repository"), value: detail.repositoryPath },
            { label: t("Branch"), value: detail.branch ?? (detail.detached ? t("Detached HEAD") : t("Unavailable")) },
            { label: "HEAD", value: detail.head ?? t("Unavailable") },
            { label: t("Local files"), value: detail.sizeBytes === undefined ? t("Unavailable") : formatBytes(detail.sizeBytes) },
            ...(detail.modifiedAt ? [{ label: t("Last modified"), value: formatDate(detail.modifiedAt) }] : [])
          ]} />
          {detail.manualReviewAvailable ? <p>{t("Review whether this work is complete. MR status and squash integration are not verified automatically.")}</p> : null}
          {detail.reasons.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>{detail.reasons.join(" · ")}</Notice> : <Notice tone="info" icon={<Check size={15} />}>{t("No local file changes found. Review the purpose of this worktree before removing it.")}</Notice>}
          {detail.changes.length ? <section><SectionLabel as="h4" count={detail.changes.length}>{t("Changed and untracked paths")}</SectionLabel><PathListPreview paths={detail.changes} /></section> : null}
          {detail.ignored.length ? <section><SectionLabel as="h4" count={detail.ignored.length}>{t("Ignored paths")}</SectionLabel><PathListPreview paths={detail.ignored} /></section> : null}
          {detail.manualReviewAvailable && !detail.cleanupReviewAvailable && !detail.keptReason ? <label className="worktree-dialog__confirmation">
            <ChoiceInput type="checkbox" checked={manualConfirm} onChange={(event) => setManualConfirm(event.target.checked)} />
            <span>{t("I reviewed this worktree and want to remove its local contents after a verified recovery copy is saved.")}</span>
          </label> : null}
        </> : null}
        {view === "confirm" ? <>
          <p>{t("Only working directories are removed. Git commits are retained; local-only files receive a verified recovery copy first.")}</p>
          <p>{t("Confirm each selected task is finished; code integration is not inferred from commit IDs.")}</p>
          {previews.some((preview) => preview.savedWorkspace) ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("A saved Workspace is inside a selected Worktree. Its shortcut will remain, but the folder will be unavailable after removal.")}
          </Notice> : null}
          {previews.some((preview) => preview.forceRequired) ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("These worktrees contain local files. Git will force-remove only the reviewed paths after their recovery copies are verified.")}
            <br />{t("Recovery copies of local-only files remain in AgentEnv data and may still use disk space.")}
          </Notice> : null}
          <AlignedResourceList actionTrack="compact" className="worktree-dialog__entries">
            {previews.map((preview) => <ResourceRow key={entryKey(preview.entry)} density="compact" appearance="plain" icon={<FolderGit2 size={16} />} title={nameFromPath(preview.entry.path)} description={<span className="selectable">{preview.entry.path}</span>} metadata={<span title={preview.entry.branch}>{preview.entry.branch ?? preview.entry.head?.slice(0, 8)}</span>} />)}
          </AlignedResourceList>
        </> : null}
        {view === "results" ? <>
          {busy === "remove" ? <OperationStatusBar icon={<LoaderCircle className="is-spinning" size={15} />} label={t("Removing Worktrees...")} detail={`${results.length}/${previews.length}`} /> : null}
          <AlignedResourceList actionTrack="compact" className="worktree-dialog__results">
            {results.map((result) => <ResourceRow key={result.path} density="compact" appearance="plain" icon={result.error ? <AlertTriangle size={16} /> : <Check size={16} />}
              title={nameFromPath(result.path)} description={<span className="selectable">{result.path}</span>}
              state={<Badge tone={result.error ? "warning" : "success"}>{result.error ? t("Skipped") : t("Removed")}</Badge>}
              />)}
          </AlignedResourceList>
          {results.filter((result) => result.error).map((result) => <Notice key={result.path} tone="danger" icon={<AlertTriangle size={15} />}><span className="selectable">{result.path}</span><DiagnosticMessage message={result.error!} /></Notice>)}
        </> : null}
        {view === "recovery" ? <>
          {recoveryIssues.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("Some recovery records need review")}
            <span className="selectable">{recoveryIssues.join("\n")}</span>
          </Notice> : null}
          {recovery.some((item) => item.status === "prepared") ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("An interrupted cleanup needs a check of its original folder and Git registration. Restore is unavailable until the removal is verified.")}
          </Notice> : null}
          {recovery.length === 0 ? <EmptyState icon={<History size={25} />} title={t("No Worktree recovery points")} /> : null}
          <AlignedResourceList className="worktree-dialog__recovery">
          {recovery.map((item) => <ResourceRow key={item.id} density="compact" appearance="plain" icon={<History size={16} />} title={nameFromPath(item.path)} description={<span className="selectable">{item.path}</span>} metadata={formatDate(item.createdAt)} state={<Badge tone={item.status === "prepared" || item.status === "restoring" ? "warning" : "neutral"}>{recoveryLabel(item.status)}</Badge>} actions={<ControlGroup>
            <IconButton label={t("Copy path")} variant="ghost" onClick={() => void window.agentEnv.copyText(item.path)}><Copy size={15} /></IconButton>
            {item.status === "restored" || item.status === "unchanged" || item.status === "prepared" ? null : <Button size="compact" icon={<RotateCcw size={14} />} busy={busy === item.id} disabled={Boolean(busy)} onClick={() => void restore(item.id)}>{t("Restore")}</Button>}
          </ControlGroup>} />)}
          </AlignedResourceList>
        </> : null}
      </div>;
  const footer = <DialogFooter>
        {view === "confirm" ? <>
          <Button disabled={Boolean(busy)} onClick={dismissReview}>{t("Cancel")}</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} busy={busy === "remove"} disabled={Boolean(busy)} onClick={() => void clean()}>{previews.length === 1 ? t("Remove Worktree") : t("Remove Worktrees")}</Button>
        </> : view === "detail" && detail ? <>
          {!detail.main ? <Button size="compact" busy={busy === "keep"} disabled={Boolean(busy)} onClick={() => void setKeep(detail)}>{detail.keptReason ? t("Remove keep marker") : t("Keep Worktree")}</Button> : null}
          {detail.manualReviewAvailable && !detail.keptReason ? <Button icon={<Trash2 size={15} />} disabled={Boolean(busy) || (!detail.cleanupReviewAvailable && !manualConfirm)} busy={busy === "preview"} onClick={() => void prepare([detail], !detail.cleanupReviewAvailable)}>{t("Review cleanup")}</Button> : null}
        </> : <Button disabled={Boolean(busy) && busy !== "scan"} onClick={dismiss}>{t("Close")}</Button>}
      </DialogFooter>;
  const modal = (
    <ModalFrame
      ariaLabel={title}
      className="worktree-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={Boolean(busy) && busy !== "scan"}
      maximized={maximized}
      size="wide"
      onDismiss={dismiss}
    >
      <DialogHeader title={title} actions={<ControlGroup>
        {presentation === "dialog" && view !== "list" ? <IconButton label={t("Back to Worktrees")} variant="ghost" disabled={Boolean(busy)} onClick={dismissReview}><ArrowLeft size={16} /></IconButton> : null}
        {view === "recovery" ? <RefreshAction label={t("Recheck recovery")} busy={busy === "recovery"} disabled={Boolean(busy)} onRefresh={() => void showRecovery()} /> : null}
        <IconButton label={maximized ? t("Restore window size") : t("Maximize window")} variant="ghost" onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>
        <IconButton ref={closeRef} label={t("Close")} variant="ghost" disabled={Boolean(busy) && busy !== "scan"} onClick={dismiss}><X size={16} /></IconButton>
      </ControlGroup>} />
      <DialogBody className="worktree-dialog__body">{view === "list" ? <>{toolbar}{list}</> : reviewBody}</DialogBody>
      {footer}
    </ModalFrame>
  );
  if (presentation === "page") return <section className="worktree-workspace" aria-label={t("Worktrees")}>
    {toolbar}
    <div className="worktree-workspace__body worktree-dialog__body">{list}</div>
    {view !== "list" ? modal : null}
  </section>;
  return modal;
};

export const WorktreeWorkspace = (props: WorktreeSortPreference) => (
  <WorktreeDialog {...props} open onClose={() => undefined} presentation="page" />
);
