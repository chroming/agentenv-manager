import { AlertTriangle, FolderGit2, RotateCcw } from "lucide-react";
import { Fragment } from "react";
import { formatBytes } from "../formatBytes";
import { useI18n } from "../i18n";
import type { WorktreeReviewItem } from "../worktreePreparation";
import { worktreeName } from "../worktreeSort";
import { AlignedResourceList, CatalogSortMetric, DetailList, DiagnosticMessage, IconButton, InteractiveStatus, Notice, ResourceRow } from "./ui";

const sumSizes = (values: Array<number | undefined>) => values.some((value) => value === undefined)
  ? undefined : values.reduce<number>((sum, value) => sum + value!, 0);

export function WorktreeCleanupReview({ items, busy, onRetry }: {
  items: WorktreeReviewItem[]; busy: boolean; onRetry(item: WorktreeReviewItem): void;
}) {
  const { t } = useI18n();
  const previews = items.flatMap((item) => item.preview ? [item.preview] : []);
  const pending = items.some((item) => !item.preview && !item.error);
  const backups = previews.filter((preview) => preview.backupRequired);
  const failures = items.filter((item) => item.error);
  const failureMessage = failures.length === 1 ? t("1 item could not be prepared and will not be removed.")
    : t("{{count}} items could not be prepared and will not be removed.", { count: failures.length });
  const size = (bytes: number | undefined) => pending ? "…" : bytes === undefined ? t("Unavailable") : formatBytes(bytes);
  return <>
    <DetailList items={[
      { label: t("Estimated space freed"), value: size(sumSizes(previews.map((preview) => preview.backupRequired ? 0 : preview.entry.sizeBytes))) },
      { label: t("Recovery copies retained"), value: size(sumSizes(backups.map((preview) => preview.entry.sizeBytes))) },
      { label: t("Local recovery copies"), value: pending ? "…" : String(backups.length) }
    ]} />
    <p>{t("Local branches and commits are kept. Remote branches are not changed.")}</p>
    {backups.length ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
      {t("Local content is backed up in full before removal. Its recovery copy still uses disk space.")}
    </Notice> : null}
    {previews.some((preview) => preview.savedWorkspace) ? <Notice tone="warning" icon={<AlertTriangle size={15} />}>
      {t("A saved Workspace is inside a selected Worktree. Its shortcut will remain, but the folder will be unavailable after removal.")}
    </Notice> : null}
    {failures.length ? <p>{failureMessage}</p> : null}
    <AlignedResourceList actionTrack="compact" className="worktree-dialog__entries">
      {items.map((item) => <Fragment key={`${item.entry.commonDir}\0${item.entry.path}`}>
        <ResourceRow density="compact" appearance="plain" icon={<FolderGit2 size={16} />}
          title={worktreeName(item.entry.path)} description={<span className="selectable" title={item.entry.path}>{item.entry.path}</span>}
          metadata={item.preview ? <span className="worktree-dialog__metrics">
            <CatalogSortMetric dateOnly kind="date" label={t("Last modified")} value={item.entry.modifiedAt}
              detail={t("Latest file modification time, excluding .git. Includes ignored files; not the last commit time.")} />
            <CatalogSortMetric kind="size" label={t("Size")} value={item.entry.sizeBytes} />
          </span> : undefined}
          state={<InteractiveStatus size="metadata" busy={!item.preview && !item.error}
            statusKind={item.error ? "error" : "neutral"}
            label={item.error ? t("Could not prepare") : !item.preview ? t("Checking...")
              : t(item.preview.backupRequired ? "Recovery copy required" : "No local changes")} />}
          actions={item.error ? <IconButton label={t("Retry review of {{name}}", { name: worktreeName(item.entry.path) })}
            variant="ghost" disabled={busy} onClick={() => onRetry(item)}><RotateCcw size={15} /></IconButton> : undefined} />
        {item.error ? <Notice tone="danger" icon={<AlertTriangle size={15} />} role="alert">
          <DiagnosticMessage message={t(item.error)} />
        </Notice> : null}
      </Fragment>)}
    </AlignedResourceList>
  </>;
}
