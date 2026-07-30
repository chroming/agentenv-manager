import type { RefObject } from "react";
import {
  ChevronRight,
  Database,
  FileText,
  GitFork,
  History,
  LoaderCircle,
  Trash2
} from "lucide-react";
import type {
  ManagedBackupInventory,
  ManagedBackupItem,
  ManagedBackupPreview
} from "../../shared/types";
import { useI18n, type TranslationValues } from "../i18n";

type Translate = (message: string, values?: TranslationValues) => string;

export interface BackupManagerNotice {
  kind: "success" | "error";
  message: string;
}

interface BackupManagerDialogProps {
  busy: boolean;
  cleanupConfirm: boolean;
  deleteCandidate?: ManagedBackupItem;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  inventory?: ManagedBackupInventory;
  inventoryLoading: boolean;
  notice?: BackupManagerNotice;
  preview?: ManagedBackupPreview;
  previewCandidate?: ManagedBackupItem;
  previewLoading: boolean;
  onBackOrClose(): void;
  onCleanup(): void;
  onDelete(): void;
  onOpenCleanupConfirm(): void;
  onOpenDelete(item: ManagedBackupItem): void;
  onPreview(item: ManagedBackupItem): void;
  onCancelCleanup(): void;
  onCancelDelete(): void;
  formatBytes(bytes: number): string;
  formatDate(value: string): string;
}

const managedBackupTitle = (item: ManagedBackupItem, t: Translate): string =>
  item.kind === "skill-cleanup"
    ? t(item.restored ? "Restored skill cleanup · {{name}}" : "Skill cleanup · {{name}}", {
        name: item.libraryId ?? item.id
      })
    : item.kind === "workspace-sync"
      ? t("Workspace update")
      : item.profileName
        ? t("{{profile}} · {{target}}", {
            profile: item.profileName,
            target: item.targetId ?? t("Agent")
          })
        : t("Agent recovery · {{target}}", {
            target: item.targetId ?? t("Unknown Agent")
          });

const managedBackupStatusLabel = (item: ManagedBackupItem, t: Translate): string => {
  if (item.requiredReason === "recovery-required") return t("Required for recovery");
  if (item.requiredReason === "workspace-sync-recovery") {
    return t("Required for Workspace recovery");
  }
  if (item.requiredReason === "takeover-baseline") return t("Takeover baseline");
  if (item.cleanupStatus === "retained") return t("Latest recovery point");
  if (item.cleanupStatus === "eligible") return t("Ready to clean");
  return t("Kept by policy");
};

export const BackupManagerDialog = ({
  busy,
  cleanupConfirm,
  deleteCandidate,
  dialogRef,
  initialFocusRef,
  inventory,
  inventoryLoading,
  notice,
  preview,
  previewCandidate,
  previewLoading,
  onBackOrClose,
  onCleanup,
  onDelete,
  onOpenCleanupConfirm,
  onOpenDelete,
  onPreview,
  onCancelCleanup,
  onCancelDelete,
  formatBytes,
  formatDate
}: BackupManagerDialogProps) => {
  const { t } = useI18n();

  return (
    <div
      className="preview-modal-backdrop"
      data-dismiss-policy="intentional"
    >
      <section
        ref={dialogRef}
        className="profile-form-dialog backup-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Manage Backups")}
        onClick={(event) => event.stopPropagation()}
      >
        {previewCandidate ? (
          <>
            <header className="profile-dialog-header backup-preview-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Backup contents")}</div>
                <p className="muted ui-dialog-description">
                  {managedBackupTitle(previewCandidate, t)}
                </p>
              </div>
              <span className="backup-preview-count">
                {t("{{count}} files", { count: previewCandidate.fileCount })}
              </span>
            </header>
            <div className="backup-preview-list" aria-busy={previewLoading}>
              {previewLoading ? (
                <div className="backup-manager-empty" role="status">
                  <LoaderCircle className="is-spinning" size={20} aria-hidden="true" />
                  <span>{t("Loading backup contents...")}</span>
                </div>
              ) : preview?.files.length ? (
                preview.files.map((file, index) => (
                  <div className="backup-preview-file" key={`${file.path}:${index}`}>
                    <FileText size={16} strokeWidth={2} aria-hidden="true" />
                    <code title={file.path}>{file.path}</code>
                    {file.state === "missing" ? (
                      <span>{t("Missing before change")}</span>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="backup-manager-empty">
                  <FileText size={22} aria-hidden="true" />
                  <strong>{t("No file entries")}</strong>
                  <span>{t("This recovery point did not need to save an existing file.")}</span>
                </div>
              )}
            </div>
            <footer className="preview-actions backup-manager-actions">
              <span>
                {formatDate(previewCandidate.createdAt)} · {formatBytes(previewCandidate.sizeBytes)}
              </span>
              <button
                ref={initialFocusRef}
                className="secondary-action"
                type="button"
                disabled={previewLoading}
                onClick={onBackOrClose}
              >
                {t("Back")}
              </button>
            </footer>
          </>
        ) : deleteCandidate ? (
          <>
            <header className="profile-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Delete backup?")}</div>
                <p className="muted ui-dialog-description">
                  {managedBackupTitle(deleteCandidate, t)}
                </p>
              </div>
            </header>
            <div className="backup-confirm-summary">
              <strong>{formatBytes(deleteCandidate.sizeBytes)}</strong>
              <p>
                {t("This recovery point cannot be restored after deletion. Profiles, Library resources, and current Agent files are unchanged.")}
              </p>
            </div>
            <footer className="preview-actions">
              <button
                ref={initialFocusRef}
                className="secondary-action"
                type="button"
                disabled={busy}
                onClick={onCancelDelete}
              >
                {t("Cancel")}
              </button>
              <button className="danger-action" type="button" disabled={busy} onClick={onDelete}>
                {t("Delete backup")}
              </button>
            </footer>
          </>
        ) : cleanupConfirm ? (
          <>
            <header className="profile-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Clean up backups?")}</div>
                <p className="muted ui-dialog-description">
                  {t(
                    (inventory?.eligibleCount ?? 0) === 1
                      ? "Delete 1 backup and free approximately {{size}}."
                      : "Delete {{count}} backups and free approximately {{size}}.",
                    {
                      count: inventory?.eligibleCount ?? 0,
                      size: formatBytes(inventory?.eligibleBytes ?? 0)
                    }
                  )}
                </p>
              </div>
            </header>
            <div className="backup-confirm-summary">
              <p>
                {t("Only recovery points outside the retention period are removed. Required recovery and takeover backups stay available.")}
              </p>
            </div>
            <footer className="preview-actions">
              <button
                ref={initialFocusRef}
                className="secondary-action"
                type="button"
                disabled={busy}
                onClick={onCancelCleanup}
              >
                {t("Cancel")}
              </button>
              <button className="danger-action" type="button" disabled={busy} onClick={onCleanup}>
                {t(
                  (inventory?.eligibleCount ?? 0) === 1
                    ? "Clean up 1 backup"
                    : "Clean up {{count}} backups",
                  { count: inventory?.eligibleCount ?? 0 }
                )}
              </button>
            </footer>
          </>
        ) : (
          <>
            <header className="profile-dialog-header backup-manager-header">
              <div className="ui-dialog-header__copy">
                <div className="section-title ui-dialog-title">{t("Manage Backups")}</div>
                <p className="muted ui-dialog-description">
                  {t(
                    (inventory?.items.length ?? 0) === 1
                      ? "{{count}} backup · {{size}}"
                      : "{{count}} backups · {{size}}",
                    {
                      count: inventory?.items.length ?? 0,
                      size: formatBytes(inventory?.totalBytes ?? 0)
                    }
                  )}
                </p>
              </div>
            </header>
            {notice ? (
              <div
                className={`backup-manager-notice is-${notice.kind}`}
                role={notice.kind === "error" ? "alert" : "status"}
              >
                {notice.message}
              </div>
            ) : null}
            <div className="backup-manager-list" aria-busy={inventoryLoading}>
              {inventoryLoading && !inventory ? (
                <div className="backup-manager-empty">{t("Calculating storage...")}</div>
              ) : inventory?.items.length ? (
                inventory.items.map((item) => (
                  <article className="backup-manager-row" key={`${item.kind}:${item.id}`}>
                    <button
                      className="backup-row-preview"
                      type="button"
                      disabled={busy}
                      aria-label={t("Preview backup {{name}}", {
                        name: managedBackupTitle(item, t)
                      })}
                      onClick={() => onPreview(item)}
                    >
                      <span className={`backup-kind-icon is-${item.kind}`} aria-hidden="true">
                        {item.kind === "skill-cleanup" ? (
                          <Database size={17} />
                        ) : item.kind === "workspace-sync" ? (
                          <GitFork size={17} />
                        ) : (
                          <History size={17} />
                        )}
                      </span>
                      <span className="backup-row-copy">
                        <strong title={managedBackupTitle(item, t)}>
                          {managedBackupTitle(item, t)}
                        </strong>
                        <small>
                          {formatDate(item.createdAt)} ·{" "}
                          {t("{{count}} files", { count: item.fileCount })} ·{" "}
                          {formatBytes(item.sizeBytes)}
                        </small>
                      </span>
                      <span
                        className={`backup-status is-${item.cleanupStatus}`}
                        title={managedBackupStatusLabel(item, t)}
                      >
                        {managedBackupStatusLabel(item, t)}
                      </span>
                      <ChevronRight
                        className="backup-row-chevron"
                        size={15}
                        strokeWidth={2.2}
                        aria-hidden="true"
                      />
                    </button>
                    {item.deletable ? (
                      <button
                        className="backup-row-delete"
                        type="button"
                        disabled={busy}
                        aria-label={t("Delete backup {{name}}", {
                          name: managedBackupTitle(item, t)
                        })}
                        onClick={() => onOpenDelete(item)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        {t("Delete")}
                      </button>
                    ) : (
                      <span
                        className="backup-required-lock"
                        title={managedBackupStatusLabel(item, t)}
                      >
                        {t("Required")}
                      </span>
                    )}
                  </article>
                ))
              ) : (
                <div className="backup-manager-empty">
                  <History size={22} aria-hidden="true" />
                  <strong>{t("No managed backups")}</strong>
                  <span>
                    {t("Recovery points will appear here after AgentEnv changes local environments.")}
                  </span>
                </div>
              )}
            </div>
            <footer className="preview-actions backup-manager-actions">
              <span>
                {inventory?.eligibleCount
                  ? t("{{count}} eligible · {{size}}", {
                      count: inventory.eligibleCount,
                      size: formatBytes(inventory.eligibleBytes)
                    })
                  : t("Nothing to clean")}
              </span>
              <button
                ref={initialFocusRef}
                className="secondary-action"
                type="button"
                disabled={busy}
                onClick={onBackOrClose}
              >
                {t("Close")}
              </button>
              <button
                className="danger-action"
                type="button"
                disabled={busy || !inventory?.eligibleCount}
                onClick={onOpenCleanupConfirm}
              >
                {t("Clean up now")}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
};
