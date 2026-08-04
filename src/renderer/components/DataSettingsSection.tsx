import { Clock3, FolderOpen, HardDrive, History, RefreshCw } from "lucide-react";
import type {
  BackupRetentionDays,
  ManagedBackupInventory
} from "../../shared/types";
import type { FreshnessState } from "../freshness";
import { formatBytes } from "../formatBytes";
import { useI18n } from "../i18n";
import { DataRootPath } from "./DataRootPath";
import { FreshnessStatus } from "./FreshnessStatus";
import { Button } from "./ui";

interface DataSettingsSectionProps {
  backupRetentionDays: BackupRetentionDays;
  busy: boolean;
  freshness: FreshnessState;
  inventory?: ManagedBackupInventory;
  inventoryLoading: boolean;
  onBackupRetentionChange(value: BackupRetentionDays): void;
  onExport(): void;
  onManageBackups(): void;
  onOpenFolder(): void;
  onRestore(): void;
}

export const DataSettingsSection = ({
  backupRetentionDays,
  busy,
  freshness,
  inventory,
  inventoryLoading,
  onBackupRetentionChange,
  onExport,
  onManageBackups,
  onOpenFolder,
  onRestore
}: DataSettingsSectionProps) => {
  const { t } = useI18n();

  return (
    <section className="resource-section settings-section" aria-labelledby="agentenv-data-heading">
      <div className="settings-section-header settings-data-header">
        <div>
          <div className="resource-heading" id="agentenv-data-heading">{t("Data & Backups")}</div>
          <p className="settings-muted">{t("AgentEnv data and the recovery points created before local changes.")}</p>
        </div>
        <div className="settings-data-actions">
          <Button
            disabled={busy}
            icon={<FolderOpen size={15} strokeWidth={2.2} aria-hidden="true" />}
            onClick={onOpenFolder}
          >
            {t("Open folder")}
          </Button>
        </div>
      </div>
      <DataRootPath />
      <div className="backup-settings-list">
        <div className="backup-settings-row">
          <span className="backup-settings-icon" aria-hidden="true">
            <History size={18} strokeWidth={2} />
          </span>
          <span className="backup-settings-copy">
            <strong>{t("Recovery storage")}</strong>
            <small>
              {inventoryLoading && !inventory
                ? t("Calculating storage...")
                : t((inventory?.items.length ?? 0) === 1 ? "{{count}} backup · {{size}}" : "{{count}} backups · {{size}}", {
                    count: inventory?.items.length ?? 0,
                    size: formatBytes(inventory?.totalBytes ?? 0)
                  })}
            </small>
          </span>
          <span className="backup-settings-row-actions">
            <FreshnessStatus state={freshness} verb="Refreshed" />
            <Button disabled={busy} onClick={onManageBackups}>{t("Manage")}</Button>
          </span>
        </div>
        <label className="backup-settings-row" htmlFor="backup-retention-days">
          <span className="backup-settings-icon" aria-hidden="true">
            <Clock3 size={18} strokeWidth={2} />
          </span>
          <span className="backup-settings-copy">
            <strong>{t("Automatic cleanup")}</strong>
            <small>{t("Applies only to managed recovery backups.")}</small>
          </span>
          <select
            id="backup-retention-days"
            aria-label={t("Backup retention")}
            disabled={busy}
            value={backupRetentionDays ?? "never"}
            onChange={(event) => {
              const value = event.currentTarget.value;
              onBackupRetentionChange(value === "never" ? null : Number(value) as BackupRetentionDays);
            }}
          >
            <option value="never">{t("Never")}</option>
            <option value="7">{t("Keep for 7 days")}</option>
            <option value="30">{t("Keep for 30 days")}</option>
            <option value="90">{t("Keep for 90 days")}</option>
          </select>
        </label>
      </div>
      <div className="settings-data-footer">
        <span className="settings-field-note">{t("Data exports are stored outside AgentEnv and are never cleaned automatically.")}</span>
        <div className="settings-data-actions">
          <Button
            disabled={busy}
            icon={<HardDrive size={15} strokeWidth={2.2} aria-hidden="true" />}
            onClick={onExport}
          >
            {t("Export data")}
          </Button>
          <Button
            disabled={busy}
            icon={<RefreshCw size={15} strokeWidth={2.2} aria-hidden="true" />}
            onClick={onRestore}
          >
            {t("Restore data")}
          </Button>
        </div>
      </div>
    </section>
  );
};
