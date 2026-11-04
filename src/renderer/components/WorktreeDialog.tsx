import {
  AlertTriangle, ArrowLeft, Check, CircleStop, Copy, FolderGit2, GitBranch,
  FolderSearch, History, LoaderCircle, LockKeyhole, Maximize2, Minimize2, Plus,
  RotateCcw, Trash2, X, Eye, EyeOff, Info
} from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type {
  WorktreeEntry, WorktreeInventory, WorktreeRecoveryRecord, WorktreeOperationProgress, WorktreeDisposalMode
} from "../../shared/worktrees";
import { canEmptyWorktreeTrashRecord, canSelectWorktreeForCleanup, isAutomaticCleanupCandidate } from "../../shared/worktrees";
import type { UiState, UiStateUpdate, WorktreeSort } from "../../shared/uiState";
import { sortWorktreeGroups, worktreeGroupMetric, worktreeName } from "../worktreeSort";
import { formatBytes } from "../formatBytes";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  AlignedResourceList, Button, CatalogSortMetric, ChoiceInput, ControlGroup, DetailList,
  DiagnosticMessage, DialogBody, DialogFooter, DialogHeader, EmptyState, IconButton,
  InteractiveStatus, ModalFrame, Notice, OperationStatusBar, PathListPreview, RefreshAction, ResourceRow, SectionLabel,
  SearchField, SortMenu, TextAction, CatalogToolbar, CatalogFilters, FilterReset, SelectField, ResourceDisclosureSection, ToolbarOverflowMenu, ContextMenu
} from "./ui";
import { AIAnalysisReview } from "./AIAnalysisReview";
import { useSearchDisclosure } from "../hooks/useSearchDisclosure";
import { selectWorktreeManually, worktreeEntryKey as entryKey, type WorktreeSelection } from "../worktreeSelection";
import { worktreeDisplayPath, worktreeRecoveryNote, worktreeStatus } from "../worktreePresentation";
import { applyWorktreePreparation, type WorktreeReviewItem } from "../worktreePreparation";
import { WorktreeSelectionMenu } from "./WorktreeSelectionMenu";
import { WorktreeCleanupReview } from "./WorktreeCleanupReview";

const nameFromPath = worktreeName;
const totalBytes = (values: Array<number | undefined>) =>
  values.some((value) => value === undefined) ? undefined : values.reduce<number>((sum, value) => sum + value!, 0);
type CleanupResult = { path: string; sourcePath?: string; id?: string; pendingGitCleanup?: boolean; mode?: WorktreeDisposalMode; error?: string; skipped?: "stopped" | "repository"; verificationWarnings?: string[]; sizeBytes?: number; reclaimedSizeBytes?: number; recoveryNote?: string };

interface WorktreeSortPreference {
  uiState?: Pick<UiState, "worktreeSort" | "worktreeCollapsedRepositories">;
  onUpdateUiState?(update: UiStateUpdate): void;
}

export const WorktreeDialog = ({ open, onClose, presentation = "dialog", uiState, onUpdateUiState }: {
  open: boolean; onClose(): void; presentation?: "dialog" | "page";
} & WorktreeSortPreference) => {
  const { t, formatDate } = useI18n();
  const reasonLabels = (entry: WorktreeEntry) => entry.reasonDetails?.map((reason) => t(reason.message, reason.values)) ?? entry.reasons.map((reason) => t(reason));
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const scanRequest = useRef(0);
  const stopCleanup = useRef(false);
  const [stopping, setStopping] = useState(false);
  const [preparationProgress, setPreparationProgress] = useState("");
  const [preparingPath, setPreparingPath] = useState("");
  const operationId = useRef("");
  const [operationProgress, setOperationProgress] = useState<WorktreeOperationProgress>();
  useEffect(() => window.agentEnv.onWorktreeProgress?.((value) => {
    if (value.requestId === operationId.current) {
      setOperationProgress(value);
      if (value.phase === "preparing" && value.total > 1) setPreparationProgress(`${value.completed}/${value.total}`);
      if (value.preparation) setReviewItems((current) => current.map((item) => applyWorktreePreparation(item, value.preparation!)));
    }
  }), []);
  const [inventory, setInventory] = useState<WorktreeInventory>();
  const [scanning, setScanning] = useState(false);
  const acceptInventory = (value: WorktreeInventory) => setInventory((current) =>
    current?.scannedAt === value.scannedAt && (current.measurementRevision ?? 0) > (value.measurementRevision ?? 0) ? current : value);
  useEffect(() => {
    if (!open) return;
    return window.agentEnv.onWorktreeInventoryChanged?.(acceptInventory);
  }, [open]);
  const [recovery, setRecovery] = useState<WorktreeRecoveryRecord[]>([]);
  const trashItems = recovery.filter(canEmptyWorktreeTrashRecord);
  const [recoveryIssues, setRecoveryIssues] = useState<string[]>([]);
  const [restoreWarnings, setRestoreWarnings] = useState<string[]>([]);
  const [recoveryScope, setRecoveryScope] = useState<"trash" | "all">("trash");
  const [view, setView] = useState<"list" | "locations" | "detail" | "confirm" | "results" | "recovery">("list");
  const [detail, setDetail] = useState<WorktreeEntry>();
  const [reviewItems, setReviewItems] = useState<WorktreeReviewItem[]>([]);
  const [disposalMode, setDisposalMode] = useState<WorktreeDisposalMode>("trash");
  const [context, setContext] = useState<{ entry: WorktreeEntry; x: number; y: number; returnFocus: HTMLElement }>();
  const previews = reviewItems.flatMap((item) => item.preview ? [item.preview] : []);
  const [selected, setSelected] = useState<WorktreeSelection[]>([]);
  const [results, setResults] = useState<CleanupResult[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [filter, setFilter] = useState<"all" | "candidate" | "review" | "kept">("all");
  const [query, setQuery] = useState("");
  const searchDisclosure = useSearchDisclosure(query);
  const [ignoredExpanded, setIgnoredExpanded] = useState(false);
  const [repositoryFocus, setRepositoryFocus] = useState("");
  const [sort, setSort] = useState<WorktreeSort>(uiState?.worktreeSort ?? "name");
  const [collapsed, setCollapsed] = useState<string[]>(uiState?.worktreeCollapsedRepositories ?? []);
  const [aiActionsTarget, setAiActionsTarget] = useState<HTMLDivElement | null>(null);
  const [gitDetailsExpanded, setGitDetailsExpanded] = useState(false);
  useEffect(() => setSort(uiState?.worktreeSort ?? "name"), [uiState?.worktreeSort]);
  const dismissReview = () => { setView("list"); setError(""); setMaximized(false); };
  const dismiss = presentation === "dialog" ? onClose : dismissReview;
  useEffect(() => {
    if (view !== "list" || !repositoryFocus) return;
    const group = [...document.querySelectorAll<HTMLElement>("[data-resource-disclosure-id]")]
      .find((element) => element.dataset.resourceDisclosureId === repositoryFocus);
    group?.scrollIntoView?.({ block: "nearest" });
    group?.querySelector<HTMLButtonElement>(".ui-toolbar-overflow-menu__trigger")?.focus();
    setRepositoryFocus("");
  }, [view, repositoryFocus]);

  useModalDialog({ open: open && (presentation === "dialog" || view !== "list"), dialogRef, initialFocusRef: closeRef, focusKey: view, onDismiss: dismiss, dismissDisabled: Boolean(busy) });

  const refresh = async (visible = true, background = false) => {
    const request = ++scanRequest.current;
    if (visible) { setScanning(true); setError(""); }
    setSelected([]);
    try {
      const result = await window.agentEnv.inventoryWorktrees(background ? "background" : undefined);
      if (request !== scanRequest.current) return;
      if (!("cancelled" in result)) acceptInventory(result);
      if (!("cancelled" in result)) return result;
    } catch (cause) {
      if (request === scanRequest.current) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (visible && request === scanRequest.current) setScanning(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    let active = true;
    setView("list");
    void (async () => {
      try {
        const cached = await window.agentEnv.cachedWorktreeInventory();
        if (!active) return;
        if (cached.inventory) acceptInventory(cached.inventory);
        if (cached.fresh && !cached.scanning) return;
      } catch { /* A cache read failure must not prevent a real scan. */ }
      if (active) await refresh(true, true);
    })();
    return () => {
      active = false;
      ++scanRequest.current;
      stopCleanup.current = true;
      operationId.current = "";
    };
  }, [open]);
  const beginAction = () => {
    if (scanning) void window.agentEnv.cancelWorktreeScan().catch(() => undefined);
    ++scanRequest.current;
    setScanning(false);
  };

  const entriesByRepo = useMemo(() => {
    const groups = new Map<string, WorktreeEntry[]>();
    const needle = query.trim().toLocaleLowerCase();
    for (const entry of inventory?.entries ?? []) {
      if (entry.main || !entry.exists && entry.pathAvailability !== "unknown") continue;
      if (needle && ![entry.path, entry.repositoryPath, entry.branch ?? ""].some((value) => value.toLocaleLowerCase().includes(needle))) continue;
      if (filter === "candidate" && !isAutomaticCleanupCandidate(entry)) continue;
      if (filter === "review" && (entry.main || entry.keptReason || entry.repositoryKeptReason || entry.state !== "review")) continue;
      if (filter === "kept" && entry.state !== "kept") continue;
      const rows = groups.get(entry.commonDir) ?? [];
      rows.push(entry);
      groups.set(entry.commonDir, rows);
    }
    return sortWorktreeGroups(
      [...groups].filter(([, rows]) => rows.some((entry) => !entry.main)), sort
    ).map(([key, rows]): [string, WorktreeEntry[]] => [key, [...rows].sort((a, b) => Number(a.state === "kept") - Number(b.state === "kept"))])
      .sort((a, b) => Number(a[1].some((entry) => Boolean(entry.repositoryKeptReason))) - Number(b[1].some((entry) => Boolean(entry.repositoryKeptReason))));
  }, [inventory, filter, query, sort]);

  const visibleEntries = entriesByRepo.flatMap(([, entries]) => entries);
  const selectionIndex = new Map(selected.map((value) => [value.key, value.origin]));
  const selectedEntries = visibleEntries.filter((entry) => canSelectWorktreeForCleanup(entry) && selectionIndex.has(entryKey(entry)));

  const addLocation = async () => {
    beginAction();
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
    beginAction();
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
    beginAction();
    setBusy("keep");
    setError("");
    try {
      await window.agentEnv.setWorktreeKeep(
        entry.commonDir, entry.path, entry.keptReason ? undefined : "Kept by user"
      );
      dismissReview();
      await refresh(false, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy("");
    }
  };
  const setRepositoryKeep = async (commonDir: string, kept: boolean) => {
    beginAction();
    setBusy(commonDir); setError("");
    try {
      await window.agentEnv.setWorktreeRepositoryKeep(commonDir, kept ? undefined : "Kept by user");
      await refresh(false, true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(""); }
  };
  const prepare = async (entries: WorktreeEntry[], mode: "manual" | "selection" | "retry" = "manual", disposal: WorktreeDisposalMode = disposalMode) => {
    if (!entries.length) return;
    beginAction();
    setDisposalMode(disposal);
    setBusy("preview");
    setPreparingPath(mode === "selection" ? "" : entries[0].path);
    setError("");
    const items: WorktreeReviewItem[] = entries.map((entry) => ({ entry,
      origin: mode === "retry" ? reviewItems.find((item) => entryKey(item.entry) === entryKey(entry))?.origin ?? "manual"
        : mode === "selection" ? selectionIndex.get(entryKey(entry)) ?? "automatic" : "manual" }));
    setReviewItems((current) => mode === "retry" ? current.map((item) => items.find((replacement) => entryKey(replacement.entry) === entryKey(item.entry)) ?? item) : items);
    setView("confirm");
    operationId.current = crypto.randomUUID();
    setPreparationProgress(`0/${entries.length}`);
    try {
      const requests = items.map(({ entry, origin }) => ({ commonDir: entry.commonDir, path: entry.path, allowDirty: origin === "manual", mode: disposal }));
      const prepared = entries.length > 1 ? await window.agentEnv.previewWorktreeCleanupBatch(requests, operationId.current)
        : [{ path: entries[0].path, preview: await window.agentEnv.previewWorktreeCleanup(requests[0].commonDir, requests[0].path, requests[0].allowDirty, disposal) }];
      setReviewItems((current) => current.map((item) => {
        if (!items.some((requested) => entryKey(requested.entry) === entryKey(item.entry))) return item;
        return applyWorktreePreparation(item, prepared.find((result) => result.path === item.entry.path)
          ?? { path: item.entry.path, error: "Could not prepare" });
      }));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setReviewItems((current) => current.map((item) => items.some((requested) => entryKey(requested.entry) === entryKey(item.entry))
        ? { ...item, preview: undefined, error: message } : item));
    }
    operationId.current = "";
    setPreparationProgress("");
    setPreparingPath("");
    setBusy("");
  };
  const setIntegration = async (entry: WorktreeEntry, ref: string) => {
    beginAction();
    setBusy("integration");
    setError("");
    try {
      await window.agentEnv.setWorktreeIntegrationRef(entry.commonDir, ref || undefined);
      const latest = await refresh(false, true);
      if (latest) setDetail(latest.entries.find((value) => entryKey(value) === entryKey(entry)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  };
  const prepareTrash = async (records: Array<Pick<WorktreeRecoveryRecord, "id" | "path">>, retry = false) => {
    if (!records.length) return;
    const items: WorktreeReviewItem[] = records.map((record) => ({ trashId: record.id, origin: "manual", entry: {
      path: record.path, commonDir: "", repositoryPath: "", main: false, exists: true, detached: true,
      state: "review", changes: [], ignored: [], reasons: [], submodules: false,
      manualReviewAvailable: true, cleanupReviewAvailable: false, headNeedsProtection: false
    } }));
    const update = (current: WorktreeReviewItem[]) => retry ? current.map((item) => items.find((next) => next.trashId === item.trashId) ?? item) : [...items];
    setError(""); setReviewItems(update); setBusy("preview"); setDisposalMode("permanent"); setView("confirm");
    try {
      for (const [index, record] of records.entries()) {
        try {
          const preview = await window.agentEnv.previewWorktreeTrashDeletion(record.id);
          items[index] = { trashId: record.id, entry: { ...preview.entry, path: record.path }, origin: "manual", preview };
        } catch (cause) { items[index] = { ...items[index], error: cause instanceof Error ? cause.message : String(cause) }; }
        setReviewItems(update);
      }
    } finally { setBusy(""); }
  };
  const clean = async () => {
    if (busy || !previews.length || reviewItems.some((item) => !item.preview && !item.error)) return;
    stopCleanup.current = false;
    setStopping(false);
    setBusy("remove");
    setError("");
    const completed: CleanupResult[] = [];
    setResults([]);
    setView("results");
    const stoppedRepositories = new Set<string>();
    for (const preview of previews) {
      if (stopCleanup.current || stoppedRepositories.has(preview.entry.commonDir)) {
        completed.push({ path: preview.entry.path, skipped: stopCleanup.current ? "stopped" : "repository", sizeBytes: preview.entry.sizeBytes });
        setResults([...completed]);
        continue;
      }
      try {
        operationId.current = crypto.randomUUID();
        setOperationProgress(undefined);
        const record = await window.agentEnv.removeWorktree(preview, operationId.current);
        completed.push({ path: record.mode ? record.path : preview.entry.path, sourcePath: preview.entry.path, id: record.id, pendingGitCleanup: record.pendingGitCleanup, mode: record.mode, sizeBytes: record.sourceSizeBytes, reclaimedSizeBytes: record.reclaimedSizeBytes,
          verificationWarnings: record.verificationWarnings, recoveryNote: worktreeRecoveryNote(record) });
        if (!preview.mode && record.verificationWarnings?.length) stoppedRepositories.add(preview.entry.commonDir);
      } catch (cause) {
        if (!preview.mode) stoppedRepositories.add(preview.entry.commonDir);
        completed.push({ path: preview.entry.path, mode: preview.mode, sizeBytes: preview.entry.sizeBytes, error: cause instanceof Error ? cause.message : String(cause) });
      }
      setResults([...completed]);
    }
    operationId.current = "";
    setSelected([]);
    setView("results");
    // Exact verified removals can leave the list immediately; unrelated repositories need not be rescanned.
    const removed = new Set(completed.filter((item) => item.error === undefined && !item.skipped).map((item) => item.sourcePath ?? item.path));
    setInventory((current) => current && ({ ...current, measuring: false, entries: current.entries
      .filter((entry) => !removed.has(entry.path))
      .map((entry) => ({ ...entry, measurementPending: false }))
      .map((entry) => !entry.main && !entry.keptReason &&
        (entry.state === "candidate" || entry.state === "review") && stoppedRepositories.has(entry.commonDir) ? {
        ...entry, state: "review", cleanupReviewAvailable: false,
        reasons: [...entry.reasons, t("Cleanup stopped for this repository. Refresh before continuing.")],
        reasonDetails: [...(entry.reasonDetails ?? entry.reasons.map((message) => ({ message }))), { message: "Cleanup stopped for this repository. Refresh before continuing." }]
      } : entry) }));
    setBusy("");
    setStopping(false);
  };
  const showRecovery = async (scope: "trash" | "all" = recoveryScope) => {
    setBusy("recovery");
    setError("");
    setRestoreWarnings([]);
    try {
      const latest = await window.agentEnv.listWorktreeRecovery(scope);
      setRecoveryScope(scope);
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
    setRestoreWarnings([]);
    try {
      const restored = await window.agentEnv.restoreWorktree(id);
      setRestoreWarnings(restored.verificationWarnings ?? []);
      const latest = await window.agentEnv.listWorktreeRecovery(recoveryScope);
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
  const sizeLabel = (bytes: number | undefined) => bytes === undefined ? t("Unavailable") : formatBytes(bytes);
  const modifiedMetric = (entry: WorktreeEntry) => <CatalogSortMetric dateOnly kind="date" label={t("Last modified")} value={entry.modifiedAt}
    detail={t("Latest file modification time, excluding .git. Includes ignored files; not the last commit time.")} />;
  const successful = results.filter((result) => result.error === undefined && !result.skipped);
  const activePreview = previews[results.length];
  const activePath = reviewItems.find((item) => item.preview?.previewId === activePreview?.previewId)?.entry.path
    ?? activePreview?.entry.path ?? operationProgress?.path ?? "";
  const elapsedSeconds = Math.floor((operationProgress?.elapsedMs ?? 0) / 1000);
  const elapsedLabel = elapsedSeconds > 0 ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, "0")}` : "";
  const removalCount = previews.length || reviewItems.length;
  const removalLabel = disposalMode === "permanent" ? t("Permanently delete {{count}}", { count: removalCount }) : t("Move {{count}} to Trash", { count: removalCount });
  const fileProgress = operationProgress?.fileProgress;
  const fileProgressMessage = fileProgress?.step === "copying"
    ? "{{count}} files found · {{size}} to copy"
    : fileProgress?.step === "verifying-backup" ? "Recovery copy: {{count}} files checked · {{size}} read"
      : fileProgress?.step === "verifying-source" ? "Source: {{count}} files checked · {{size}} read"
        : "{{count}} files checked · {{size}} read";
  const fileProgressDetail = fileProgress ? t(fileProgressMessage, { count: fileProgress.filesCounted, size: formatBytes(fileProgress.bytesCounted) }) : "";

  const title = view === "locations" ? t("Scan locations") : view === "detail" && detail
    ? nameFromPath(detail.path) : view === "confirm" ? (disposalMode === "permanent" ? t("Permanently delete Worktrees?") : t("Move Worktrees to Trash?"))
    : view === "results" ? t("Cleanup results") : view === "recovery" ? t("Trash and recovery") : t("Worktrees");
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
    setDetail(entry); setGitDetailsExpanded(false); setError(""); setView("detail");
  };
  const toolbar = <CatalogToolbar aria-label={t("Worktrees")}
        search={<SearchField label={t("Search Worktrees")} placeholder={t("Search")} value={query} onChange={(event) => { setQuery(event.target.value); setSelected([]); }} />}
        controls={<>
          <SortMenu<WorktreeSort> label={t("Sort Worktrees")} value={sort} active={sort !== "name"}
            options={[
              { value: "name", label: t("Name") },
              { value: "modified-desc", label: t("Newest modified") },
              { value: "modified-asc", label: t("Oldest modified") },
              { value: "size-desc", label: t("Largest size") },
              { value: "status", label: t("Cleanup status") }
            ]} onChange={(value) => { setSort(value); onUpdateUiState?.({ worktreeSort: value }); }} />
          <CatalogFilters count={Number(filter !== "all")} summary={filter === "candidate" ? t("Automatically selectable") : filter === "review" ? t("Needs review") : t("Excluded")}>
            <SelectField label={t("Worktree filter")} value={filter} onChange={(event) => { setFilter(event.currentTarget.value as typeof filter); setSelected([]); }}>
              <option value="all">{t("All")}</option>
              <option value="candidate">{t("Automatically selectable")}</option>
              <option value="review">{t("Needs review")}</option>
              <option value="kept">{t("Excluded")}</option>
            </SelectField>
            <FilterReset disabled={filter === "all"} onReset={() => { setFilter("all"); setSelected([]); }} />
          </CatalogFilters>
        </>} actions={<>
          <WorktreeSelectionMenu entries={visibleEntries} selected={selected} onChange={setSelected} scope="view" disabled={Boolean(busy) || !visibleEntries.length} />
          <IconButton label={t("Scan locations")} variant="ghost" disabled={Boolean(busy)} onClick={() => { setError(""); setView("locations"); }} title={inventory?.incomplete ? [t("Some locations could not be fully scanned"), ...inventory.issues].join("\n") : t("Scan locations")}>
            {inventory?.incomplete ? <AlertTriangle size={16} /> : <FolderSearch size={16} />}
          </IconButton>
          <RefreshAction label={t("Refresh Worktrees")} busy={scanning} disabled={Boolean(busy)} onRefresh={() => void refresh()} />
          {scanning ? <IconButton label={t("Stop scanning")} variant="ghost" onClick={() => void window.agentEnv.cancelWorktreeScan()}><CircleStop size={16} /></IconButton> : null}
          <IconButton label={t("Worktree Trash")} variant="ghost" busy={busy === "recovery"} disabled={Boolean(busy)} onClick={() => void showRecovery()}><Trash2 size={16} /></IconButton>
        </>}
      />;
  const failure = error ? <Notice tone="danger" icon={<AlertTriangle size={15} />} role="alert"><DiagnosticMessage message={error} /></Notice> : null;
  const list = <>
          {view === "list" ? failure : null}
          {selectedEntries.length ? <ResourceRow density="compact" appearance="plain" icon={null}
            title={t("{{count}} selected", { count: selectedEntries.length })}
            metadata={<span title={selectedEntries.some((entry) => entry.measurementPending) ? `${t("Selected size")}: ${t("Measuring size...")}` : t("Selected size")}>{busy === "preview" && !preparingPath ? preparationProgress : selectedEntries.some((entry) => entry.measurementPending) ? "…" : sizeLabel(totalBytes(selectedEntries.map((entry) => entry.sizeBytes)))}</span>}
            actions={<ControlGroup density="compact"><Button size="compact" icon={<Trash2 size={15} />} aria-label={`${t("Move to Trash...")} (${selectedEntries.length})`}
              busy={busy === "preview" && !preparingPath && disposalMode === "trash"} disabled={Boolean(busy) || !selectedEntries.length}
              onClick={() => void prepare(selectedEntries, "selection", "trash")}>{t("Move to Trash...")}</Button>
              <Button size="compact" variant="danger" busy={busy === "preview" && !preparingPath && disposalMode === "permanent"} disabled={Boolean(busy)} onClick={() => void prepare(selectedEntries, "selection", "permanent")}>{t("Delete permanently...")}</Button></ControlGroup>} /> : null}
          {scanning && !inventory ? <EmptyState icon={<LoaderCircle className="is-spinning" size={25} />} title={t("Scanning Worktrees...")} /> : null}
          {entriesByRepo.length === 0 && !scanning ? <EmptyState icon={<FolderGit2 size={25} />}
            title={filter === "all" ? t("No Worktrees found") : filter === "candidate" ? t("No automatically selectable Worktrees") : filter === "review" ? t("No Worktrees to review") : t("No excluded Worktrees")}
            description={filter === "all" ? t("Add a scan location to look for local Git working directories.") : undefined} /> : null}
          {[false, true].map((ignored) => {
            const groups = entriesByRepo.filter(([, entries]) => entries.some((entry) => Boolean(entry.repositoryKeptReason)) === ignored);
            const sections = groups.map(([commonDir, entries]) => {
            const kept = entries.some((entry) => Boolean(entry.repositoryKeptReason));
            return <Fragment key={commonDir}>
            <ResourceDisclosureSection className="worktree-dialog__group" id={commonDir}
              appearance="list" density="compact" panelScrollOwner="child" icon={<GitBranch size={15} />}
              title={nameFromPath(entries[0].repositoryPath)} toggleLabel={nameFromPath(entries[0].repositoryPath)}
              summary={kept ? t("Ignored") : String(entries.length)} summaryTitle={entries[0].repositoryPath}
              expanded={searchDisclosure.expanded(commonDir, !collapsed.includes(commonDir))} onToggle={() => searchDisclosure.toggle(commonDir, () => {
                const next = collapsed.includes(commonDir) ? collapsed.filter((key) => key !== commonDir) : [...collapsed, commonDir];
                setCollapsed(next); onUpdateUiState?.({ worktreeCollapsedRepositories: next });
              })} actions={<ControlGroup>
              {entries.some((entry) => entry.measurementPending) ? <InteractiveStatus size="metadata" busy label={t("Measuring size...")} />
                : <CatalogSortMetric kind="size" label={t("Total size")} value={worktreeGroupMetric(entries, "size-desc")} />}
              <ToolbarOverflowMenu label={t("Repository actions")} menuLabel={t("Repository actions")} busy={busy === commonDir} disabled={Boolean(busy)} items={[
                { id: "keep", label: t(kept ? "Stop ignoring repository" : "Ignore repository"), icon: kept ? <Eye size={15} /> : <EyeOff size={15} />, onSelect: () => void setRepositoryKeep(commonDir, kept) }
              ]} />
              {!kept ? <WorktreeSelectionMenu entries={entries} selected={selected} onChange={setSelected} scope="repository" disabled={Boolean(busy)} /> : null}
            </ControlGroup>}>
            <AlignedResourceList actionTrack="compact" className="worktree-dialog__entries worktree-dialog__selectable-entries">
            {entries.map((entry) => { const status = worktreeStatus(entry); return <ResourceRow
              onContextMenu={(event) => { if (busy || !canSelectWorktreeForCleanup(entry)) return; event.preventDefault(); setContext({ entry, x: event.clientX, y: event.clientY, returnFocus: event.currentTarget.querySelector<HTMLElement>("button") ?? event.currentTarget }); }}
              key={entryKey(entry)} density="compact" appearance="plain" icon={entry.locked ? <LockKeyhole size={16} /> : <FolderGit2 size={16} />}
              title={<TextAction title={[entry.path, entry.branch ? `${t("Branch")}: ${entry.branch}` : entry.head].filter(Boolean).join("\n")} onClick={() => review(entry)}>{nameFromPath(entry.path)}</TextAction>}
              description={<span className="worktree-dialog__identity"><span className="selectable" title={entry.path}>{worktreeDisplayPath(entry)}</span>
                {entry.branch && entry.branch !== nameFromPath(entry.path) ? <span title={entry.branch}>{entry.branch}</span> : null}</span>}
              metadata={entry.main ? undefined : <span className="worktree-dialog__metrics">
                {entry.measurementPending ? <InteractiveStatus size="metadata" label={t("Measuring size...")} /> : <>
                  {modifiedMetric(entry)}
                  <CatalogSortMetric kind="size" label={t("Size")} value={entry.sizeBytes} />
                </>}
              </span>}
              state={<InteractiveStatus size="metadata" tone={status.tone} title={reasonLabels(entry).join("\n")} reviewLabel={t("Review {{name}}", { name: nameFromPath(entry.path) })} onReview={() => review(entry)}
                label={t(status.message, status.values)} />}
              actions={<span className="worktree-dialog__row-action">
                {canSelectWorktreeForCleanup(entry) ? <ChoiceInput
                  type="checkbox" alignment="flush" aria-label={t("Select Worktree for review")}
                  disabled={Boolean(busy)}
                  checked={selectionIndex.has(entryKey(entry))}
                  onChange={(event) => { const checked = event.currentTarget.checked; setSelected((current) => selectWorktreeManually(current, entry, checked)); }}
                /> : null}
              </span>}
              secondaryActions={canSelectWorktreeForCleanup(entry) ? <IconButton label={t("Move to Trash...")}
                variant="ghost" busy={busy === "preview" && preparingPath === entry.path} disabled={Boolean(busy)}
                onClick={() => void prepare([entry], "manual", "trash")}><Trash2 size={15} /></IconButton> : undefined}
            />; })}
            </AlignedResourceList>
          </ResourceDisclosureSection></Fragment>; });
            return ignored ? groups.length > 0 ? <ResourceDisclosureSection key="ignored" id="ignored-repositories"
              appearance="list" density="compact" panelScrollOwner="child" muted icon={<EyeOff size={15} />}
              title={t("Ignored repositories")} toggleLabel={t("Ignored repositories")} summary={String(groups.length)}
              expanded={searchDisclosure.expanded("ignored-repositories", ignoredExpanded)}
              onToggle={() => searchDisclosure.toggle("ignored-repositories", () => setIgnoredExpanded((value) => !value))}>
              {sections}
            </ResourceDisclosureSection> : null : <Fragment key="active">{sections}</Fragment>;
          })}
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
            { label: t("Local files"), value: detail.sizeBytes === undefined ? t("Unavailable") : formatBytes(detail.sizeBytes) },
            { label: t("Last modified"), value: detail.modifiedAt && Number.isFinite(Date.parse(detail.modifiedAt)) ? formatDate(detail.modifiedAt) : t("Unavailable") }
          ]} />
          {detail.reasons.length ? worktreeStatus(detail).tone === "warning"
            ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>{reasonLabels(detail).join(" · ")}</Notice>
            : <p>{reasonLabels(detail).join(" · ")}</p> : <p>{t("No local file changes found. Review the purpose of this worktree before removing it.")}</p>}
          {detail.reasonDetails?.filter((reason) => reason.detail).map((reason, index) => <DiagnosticMessage key={index} message={reason.detail!} />)}
          {detail.changes.length ? <section><SectionLabel as="h4" count={detail.changes.length}>{t("Changed and untracked paths")}</SectionLabel><PathListPreview paths={detail.changes} /></section> : null}
          {detail.ignored.length ? <section><SectionLabel as="h4" count={detail.ignored.length}>{t("Ignored paths")}</SectionLabel><PathListPreview paths={detail.ignored} /></section> : null}
          {!detail.main && detail.exists ? <AIAnalysisReview actionsTarget={aiActionsTarget} subject={{ kind: "worktree", commonDir: detail.commonDir, path: detail.path }} /> : null}
          <ResourceDisclosureSection appearance="list" density="compact" id="worktree-git-details" title={t("Git details")} toggleLabel={t("Git details")}
            expanded={gitDetailsExpanded} onToggle={() => setGitDetailsExpanded((value) => !value)} panelScrollOwner="child">
          <DetailList items={[
            { label: t("Repository"), value: detail.repositoryPath },
            { label: t("Branch"), value: detail.branch ?? (detail.detached ? t("Detached HEAD") : t("Unavailable")) },
            { label: "HEAD", value: detail.head ?? t("Unavailable") },
            ...(detail.integration ? [{ label: t("Integration"), value: detail.integration.merged && detail.integration.ref !== `refs/heads/${detail.branch}` ? t("Contained in target") : t("Not confirmed") }] : [])
          ]} />
          {detail.integration ? <SelectField label={t("Integration target")} disabled={Boolean(busy)}
            value={detail.integration.explicit ? detail.integration.ref ?? "" : ""}
            onChange={(event) => void setIntegration(detail, event.currentTarget.value)}>
            <option value="">{!detail.integration.explicit && detail.integration.ref ? t("Automatic: {{ref}}", { ref: detail.integration.ref.replace(/^refs\/(heads|remotes)\//, "") }) : t("Automatic")}</option>
            {[...new Set([...detail.integration.choices, ...(detail.integration.explicit && detail.integration.ref ? [detail.integration.ref] : [])])].map((ref) =>
              <option key={ref} value={ref}>{ref.replace(/^refs\/(heads|remotes)\//, "")}</option>)}
          </SelectField> : null}
          {detail.manualReviewAvailable ? <p>{t("Review whether this work is complete. MR status and squash integration are not verified automatically.")}</p> : null}
          </ResourceDisclosureSection>
        </> : null}
        {view === "confirm" ? <>
          <WorktreeCleanupReview items={reviewItems} mode={disposalMode} busy={Boolean(busy)} onRetry={(item) => item.trashId ? void prepareTrash([{ id: item.trashId, path: item.entry.path }], true) : void prepare([item.entry], "retry")} />
        </> : null}
        {view === "results" ? <>
          {busy !== "remove" || successful.length > 0 ? <DetailList items={[
            { label: t("Removed size"), value: sizeLabel(totalBytes(successful.map((result) => result.sizeBytes))) },
            { label: t("Estimated space freed"), value: sizeLabel(totalBytes(successful.map((result) => result.reclaimedSizeBytes))) },
            { label: t(results.some((result) => result.mode) ? "Space retained in Trash" : "Recovery copies retained"), value: sizeLabel(results.some((result) => result.error !== undefined) ? undefined : totalBytes(successful.map((result) => result.sizeBytes === undefined || result.reclaimedSizeBytes === undefined ? undefined : Math.max(0, result.sizeBytes - result.reclaimedSizeBytes)))) }
          ]} /> : null}
          {busy === "remove" ? <OperationStatusBar icon={<LoaderCircle className="is-spinning" size={15} />}
            label={operationProgress?.phase === "backing-up" ? t("Backing up local files...") : operationProgress?.phase === "verifying" ? t("Verifying removal...") : operationProgress?.phase === "removing" ? disposalMode === "trash" ? t("Moving Worktrees to Trash...") : t("Deleting Worktrees...") : t("Checking selected Worktree...")}
            detail={[`${results.length}/${previews.length} · ${nameFromPath(activePath)}`, elapsedLabel, fileProgressDetail].filter(Boolean).join(" · ")} /> : null}
          <AlignedResourceList actionTrack="compact" className="worktree-dialog__entries worktree-dialog__results">
            {results.map((result) => <ResourceRow key={result.id ?? result.path} density="compact" appearance="plain" icon={result.error !== undefined || result.skipped || result.verificationWarnings?.length ? <AlertTriangle size={16} /> : <Check size={16} />}
              title={nameFromPath(result.path)} description={<span className="selectable">{result.path}</span>}
              metadata={<CatalogSortMetric kind="size" label={t("Size")} value={result.sizeBytes} />}
              state={<InteractiveStatus size="metadata" statusKind={result.error !== undefined ? "error" : result.skipped ? "neutral" : result.verificationWarnings?.length ? "warning" : "success"}
                label={result.skipped ? t("Not run") : result.error !== undefined ? t("Failed") : result.mode === "trash" ? t("Moved to Trash") : result.mode === "permanent" ? t("Deleted") : result.pendingGitCleanup ? t("Registration cleanup pending") : result.verificationWarnings?.length ? t("Removed; needs review") : t("Removed")} />}
              actions={result.pendingGitCleanup && result.id ? <IconButton label={t("Retry cleanup")} disabled={Boolean(busy)} onClick={() => void prepareTrash([{ id: result.id!, path: result.path }])}><RotateCcw size={15} /></IconButton> : undefined} />)}
          </AlignedResourceList>
          {successful.some((result) => result.mode === "trash") ? <p>{t("Items in Trash still use disk space until permanently deleted.")}</p> : null}
          {previews.some((preview) => !preview.mode && preview.backupRequired && successful.some((result) => result.path === preview.entry.path)) ? <p>{t("Recovery copies are retained. Their size is excluded from estimated space freed.")}</p> : null}
          {results.filter((result) => result.error !== undefined).map((result) => <Notice key={result.path} tone="danger" icon={<AlertTriangle size={15} />}><span className="selectable">{result.path}</span><DiagnosticMessage message={result.error!} /></Notice>)}
          {results.flatMap((result) => result.verificationWarnings?.map((warning) => <Notice key={`${result.path}:${warning}`} tone="warning" icon={<AlertTriangle size={15} />}><span className="selectable">{result.path}</span><DiagnosticMessage message={t(warning)} /></Notice>) ?? [])}
          {results.filter((result) => result.recoveryNote).map((result) => <Notice key={`recovery:${result.path}`} tone="info" icon={<Info size={15} />}><span className="selectable">{result.path}</span>{t(result.recoveryNote!)}</Notice>)}
          {results.some((result) => result.skipped === "repository") ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>{t("Remaining Worktrees in the affected repository were not removed. Refresh and review that repository before continuing.")}</Notice> : null}
          {results.some((result) => result.skipped === "stopped") ? <Notice tone="info">{t("Cleanup stopped. Remaining Worktrees were not changed.")}</Notice> : null}
        </> : null}
        {view === "recovery" ? <>
          {restoreWarnings.map((warning) => <Notice key={warning} tone="warning" title={t("Restored")} icon={<AlertTriangle size={15} />}><DiagnosticMessage message={t(warning)} /></Notice>)}
          {recoveryIssues.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("Some recovery records need review")}
            <span className="selectable">{recoveryIssues.join("\n")}</span>
          </Notice> : null}
          {recovery.some((item) => item.status === "prepared" && !item.mode) ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
            {t("An interrupted cleanup needs a check of its original folder and Git registration. Restore is unavailable until the removal is verified.")}
          </Notice> : null}
          {trashItems.length ? <DetailList items={[
            { label: t("Items in Trash"), value: String(trashItems.length) },
            { label: t("Space retained in Trash"), value: sizeLabel(totalBytes(trashItems.map((item) => item.disposalIncomplete ? undefined : item.sourceSizeBytes))) }
          ]} /> : null}
          {recovery.length === 0 ? <EmptyState icon={<History size={25} />} title={recoveryScope === "trash" ? t("Trash is empty") : t("No Worktree recovery points")} /> : null}
          <AlignedResourceList className="worktree-dialog__recovery">
          {recovery.map((item) => <ResourceRow key={item.id} density="compact" appearance="plain" icon={item.mode ? <Trash2 size={16} /> : <History size={16} />} title={nameFromPath(item.path)} description={<span className="selectable">{item.path}</span>} metadata={<span className="worktree-dialog__metrics"><span>{formatDate(item.createdAt)}</span><span title={item.mode ? t("Space retained in Trash") : t("Recovery copies retained")}>{item.mode || item.backupHash ? sizeLabel(item.pendingGitCleanup ? 0 : item.sourceSizeBytes) : t("Commits retained")}</span></span>} state={<InteractiveStatus size="metadata" statusKind={item.status === "prepared" || item.status === "restoring" || item.pendingGitCleanup || item.disposalIncomplete ? "warning" : item.status === "restored" ? "success" : "neutral"} label={item.pendingGitCleanup ? t("Registration cleanup pending") : item.disposalIncomplete ? item.mode === "trash" ? t("Move incomplete") : t("Deletion incomplete") : item.mode === "trash" && item.status === "removed" ? t("In Trash") : recoveryLabel(item.status)} icon={worktreeRecoveryNote(item) ? <Info size={14} /> : undefined} title={worktreeRecoveryNote(item) ? t(worktreeRecoveryNote(item)!) : undefined} />} actions={<ControlGroup density="compact">
            <IconButton label={item.retainedPath ? t("Copy Trash location") : t("Copy path")} variant="ghost" onClick={() => void window.agentEnv.copyText(item.retainedPath ?? item.path)}><Copy size={15} /></IconButton>
            {item.status === "restored" || item.status === "unchanged" || (item.status === "prepared" && !item.mode) || item.mode === "permanent" ? null : <Button size="compact" icon={<RotateCcw size={14} />} busy={busy === item.id} disabled={Boolean(busy)} onClick={() => void restore(item.id)}>{t("Restore")}</Button>}
            {canEmptyWorktreeTrashRecord(item) || item.mode && item.pendingGitCleanup && item.status === "removed" ? <IconButton label={t(item.pendingGitCleanup ? "Retry cleanup" : "Delete permanently...")} variant="ghost" disabled={Boolean(busy)} onClick={() => void prepareTrash([item])}>{item.pendingGitCleanup ? <RotateCcw size={15} /> : <Trash2 size={15} />}</IconButton> : null}
          </ControlGroup>} />)}
          </AlignedResourceList>
        </> : null}
      </div>;
  const footer = <DialogFooter>
        {view === "results" && busy === "remove" ? <IconButton label={t("Stop after current")} variant="ghost" disabled={stopping}
          onClick={() => { stopCleanup.current = true; setStopping(true); }}><CircleStop size={16} /></IconButton> : null}
        {view === "results" && stopping ? <span role="status">{t("Finishing the current Worktree before stopping...")}</span> : null}
        {view === "confirm" ? <>
          <Button disabled={Boolean(busy)} onClick={dismissReview}>{t("Cancel")}</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} busy={busy === "preview" || busy === "remove"} disabled={Boolean(busy) || !previews.length || reviewItems.some((item) => !item.preview && !item.error)} onClick={() => void clean()}>{removalLabel}</Button>
        </> : view === "detail" && detail ? <>
          <ControlGroup ref={setAiActionsTarget} />
          {detail.repositoryKeptReason ? <ControlGroup><InteractiveStatus size="metadata" label={t("Repository ignored")} />
            <TextAction disabled={Boolean(busy)} onClick={() => { setQuery(""); setFilter("all"); setIgnoredExpanded(true); setRepositoryFocus(detail.commonDir); dismissReview(); }}>{t("View repository")}</TextAction></ControlGroup>
            : !detail.main ? <Button busy={busy === "keep"} disabled={Boolean(busy)} onClick={() => void setKeep(detail)}>{detail.keptReason ? t("Stop ignoring Worktree") : t("Ignore Worktree")}</Button> : null}
          {canSelectWorktreeForCleanup(detail) ? <ControlGroup><Button icon={<Trash2 size={15} />} disabled={Boolean(busy)} busy={busy === "preview"} onClick={() => void prepare([detail], "manual", "trash")}>{t("Move to Trash...")}</Button>
            <Button variant="danger" disabled={Boolean(busy)} onClick={() => void prepare([detail], "manual", "permanent")}>{t("Delete permanently...")}</Button></ControlGroup> : null}
        </> : <>
          {view === "recovery" && trashItems.length > 0 ? <Button variant="danger" icon={<Trash2 size={15} />} disabled={Boolean(busy)} onClick={() => void prepareTrash(trashItems)}>{t("Empty Trash...")}</Button> : null}
          {view === "results" && !busy && results.length ? <Button icon={<Trash2 size={15} />} onClick={() => void showRecovery("trash")}>{t("View Trash")}</Button> : null}
          <Button variant={view === "results" && !busy && results.length > 0 && results.every((result) => result.error === undefined && !result.skipped && !result.verificationWarnings?.length) ? "primary" : "secondary"} disabled={Boolean(busy)} onClick={dismiss}>{t("Close")}</Button>
        </>}
      </DialogFooter>;
  const modal = (
    <ModalFrame
      ariaLabel={title}
      className="worktree-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={Boolean(busy)}
      maximized={maximized}
      size="wide"
      onDismiss={dismiss}
    >
      <DialogHeader title={title} actions={<ControlGroup>
        {presentation === "dialog" && view !== "list" ? <IconButton label={t("Back to Worktrees")} variant="ghost" disabled={Boolean(busy)} onClick={dismissReview}><ArrowLeft size={16} /></IconButton> : null}
        {view === "recovery" ? <RefreshAction label={t("Recheck recovery")} busy={busy === "recovery"} disabled={Boolean(busy)} onRefresh={() => void showRecovery()} /> : null}
        {view === "recovery" ? <IconButton label={recoveryScope === "trash" ? t("Previous recovery points") : t("Worktree Trash")} disabled={Boolean(busy)} onClick={() => void showRecovery(recoveryScope === "trash" ? "all" : "trash")}><History size={16} /></IconButton> : null}
        <IconButton label={maximized ? t("Restore window size") : t("Maximize window")} variant="ghost" onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>
        <IconButton ref={closeRef} label={t("Close")} variant="ghost" disabled={Boolean(busy)} onClick={dismiss}><X size={16} /></IconButton>
      </ControlGroup>} />
      <DialogBody className="worktree-dialog__body">{view === "list" ? <>{toolbar}{list}</> : reviewBody}</DialogBody>
      {footer}
    </ModalFrame>
  );
  const contextMenu = context ? <ContextMenu label={t("Worktree actions")} anchor={context} onClose={() => setContext(undefined)} items={[
    { id: "trash", label: t("Move to Trash..."), icon: <Trash2 size={15} />, onSelect: () => void prepare([context.entry], "manual", "trash") },
    { id: "permanent", label: t("Delete permanently..."), icon: <Trash2 size={15} />, danger: true, onSelect: () => void prepare([context.entry], "manual", "permanent") }
  ]} /> : null;
  if (presentation === "page") return <section className="worktree-workspace" aria-label={t("Worktrees")}>
    {toolbar}
    <div className="worktree-workspace__body worktree-dialog__body">{list}</div>
    {view !== "list" ? modal : null}
    {contextMenu}
  </section>;
  return <>{modal}{contextMenu}</>;
};

export const WorktreeWorkspace = (props: WorktreeSortPreference) => (
  <WorktreeDialog {...props} open onClose={() => undefined} presentation="page" />
);
