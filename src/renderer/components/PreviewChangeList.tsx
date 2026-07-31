import {
  ChevronDown,
  FileText,
  Folder,
  MapPin,
  Maximize2
} from "lucide-react";
import type { RefObject } from "react";
import type {
  ActivationPreview,
  PlannedFileChange,
  PlannedResourceChange,
  RollbackPreview,
  StopManagingPreview
} from "../../shared/types";
import { useI18n } from "../i18n";
import { ProductIcon } from "../productIcons";
import { DiffViewer } from "./DiffViewer";
import { FileTypeIcon } from "./FileTypeIcon";
import { OverflowTooltip } from "./OverflowTooltip";
import { Button } from "./ui";

type Preview = ActivationPreview | RollbackPreview | StopManagingPreview;
type GroupId = "instructions" | "skills" | "mcp" | "storage" | "configuration" | "cleanup";

interface ChangeGroup {
  id: GroupId;
  files: PlannedFileChange[];
  resources: PlannedResourceChange[];
}

const basename = (path: string) => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
};

const fileAction = (change: PlannedFileChange) => {
  if (change.action === "remove") return "Remove";
  if (change.before.length === 0 && change.after.length > 0) return "Add";
  if (change.before.length > 0 && change.after.length === 0) return "Remove";
  return "Replace";
};

const lineCount = (text: string) => {
  if (text.length === 0) return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
};

const groupForFile = (change: PlannedFileChange): GroupId => {
  if (change.category === "instructions") return "instructions";
  if (change.category === "mcp") return "mcp";
  return "configuration";
};

const groupForResource = (change: PlannedResourceChange): GroupId => {
  if (change.kind === "skill") return "skills";
  if (change.kind === "agent") return "instructions";
  if (change.kind === "directory") return "storage";
  return "configuration";
};

const groupIcon = (id: GroupId) => {
  if (id === "instructions") return <ProductIcon name="instructions" size={17} strokeWidth={2} />;
  if (id === "skills") return <ProductIcon name="skills" size={17} strokeWidth={2} />;
  if (id === "mcp") return <ProductIcon name="mcps" size={17} strokeWidth={2} />;
  if (id === "storage") return <Folder size={17} strokeWidth={2} />;
  return <FileText size={17} strokeWidth={2} />;
};

export const PreviewChangeList = ({
  preview,
  activation,
  expandButtonRef,
  onExpandPreview
}: {
  preview: Preview;
  activation: boolean;
  expandButtonRef?: RefObject<HTMLButtonElement | null>;
  onExpandPreview?(): void;
}) => {
  const { t } = useI18n();
  const resources = "resourceChanges" in preview ? preview.resourceChanges : [];
  const sharedPreparations =
    activation && "sharedSkillPreparations" in preview && preview.sharedSkillPreparationChanged
      ? (preview.sharedSkillPreparations ?? [])
      : [];
  const groups = new Map<GroupId, ChangeGroup>();
  const ensureGroup = (id: GroupId) => {
    const existing = groups.get(id);
    if (existing) return existing;
    const created = { id, files: [], resources: [] };
    groups.set(id, created);
    return created;
  };

  preview.changes.forEach((change) => ensureGroup(groupForFile(change)).files.push(change));
  resources.forEach((change) => ensureGroup(groupForResource(change)).resources.push(change));
  if (sharedPreparations.length > 0) ensureGroup("cleanup");

  const order: GroupId[] = [
    "instructions",
    "skills",
    "mcp",
    "storage",
    "configuration",
    "cleanup"
  ];
  const visibleGroups = order
    .map((id) => groups.get(id))
    .filter((group): group is ChangeGroup => Boolean(group));
  const totalChanges =
    preview.changes.length + resources.length + sharedPreparations.length;

  if (totalChanges === 0) return null;

  const groupTitle = (id: GroupId) => {
    if (id === "instructions") return t("Instructions");
    if (id === "skills") return t("Skills");
    if (id === "mcp") return t("MCP configuration");
    if (id === "storage") return t("Skill storage");
    if (id === "cleanup") return t("Shared Skill migration plan");
    return t("Configuration files");
  };
  const resourceKindLabel = (kind: PlannedResourceChange["kind"]) => {
    if (kind === "skill") return t("Skill");
    if (kind === "agent") return t("Instruction file");
    if (kind === "directory") return t("Directory");
    return t("File");
  };

  return (
    <section className="apply-preview-changes" aria-label={t("Planned changes")}>
      <header className="apply-preview-section-heading">
        <div>
          <strong>{t("Planned changes")}</strong>
          <span className="apply-preview-count" aria-label={
            totalChanges === 1
              ? t("1 change")
              : t("{{count}} changes", { count: totalChanges })
          }>
            {totalChanges}
          </span>
        </div>
        {preview.changes.length > 0 && onExpandPreview ? (
          <Button
            ref={expandButtonRef}
            icon={<Maximize2 size={14} />}
            size="compact"
            variant="ghost"
            onClick={onExpandPreview}
          >
            {t("Expand preview")}
          </Button>
        ) : null}
      </header>
      <div className="apply-preview-change-groups">
        {visibleGroups.map((group) => {
          const count =
            group.files.length +
            group.resources.length +
            (group.id === "cleanup" ? sharedPreparations.length : 0);
          return (
            <section className="apply-preview-change-group" key={group.id}>
              <header>
                <span className="apply-preview-change-group__icon" aria-hidden="true">
                  {groupIcon(group.id)}
                </span>
                <strong>{groupTitle(group.id)}</strong>
                <span className="apply-preview-count">{count}</span>
              </header>
              <div role="list">
                {group.resources.map((change) => (
                  <article className="apply-preview-change-row" role="listitem" key={`${change.action}:${change.path}`}>
                    <span className="apply-preview-change-row__identity">
                      <strong>{change.name}</strong>
                      {change.source ? (
                        <OverflowTooltip
                          ariaLabel={t("Full source for {{name}}", { name: change.name })}
                          className="apply-preview-change-row__meta"
                          text={change.source}
                        />
                      ) : (
                        <small>{resourceKindLabel(change.kind)}</small>
                      )}
                    </span>
                    <OverflowTooltip
                      ariaLabel={t("Full location for {{name}}", { name: change.name })}
                      className="apply-preview-location"
                      displayContent={<MapPin size={15} strokeWidth={2} aria-hidden="true" />}
                      text={change.path}
                      tooltipClassName="apply-preview-path-tooltip"
                    />
                    <span className={`change-kind change-kind--${change.action}`}>
                      {t(change.action === "install" ? "Install" : change.action === "replace" ? "Replace" : "Remove")}
                    </span>
                  </article>
                ))}
                {group.files.map((change) => {
                  const action = fileAction(change);
                  const name = basename(change.path);
                  return (
                    <details className="apply-preview-file-change" key={change.path}>
                      <summary>
                        <FileTypeIcon kind="file" path={change.path} />
                        <span className="apply-preview-change-row__identity">
                          <strong>{name}</strong>
                          <small>
                            {t("{{before}} before · {{after}} after", {
                              before: lineCount(change.before),
                              after: lineCount(change.after)
                            })}
                          </small>
                        </span>
                        <OverflowTooltip
                          ariaLabel={t("Full location for {{name}}", { name })}
                          className="apply-preview-location"
                          displayContent={<MapPin size={15} strokeWidth={2} aria-hidden="true" />}
                          text={change.path}
                          tooltipClassName="apply-preview-path-tooltip"
                        />
                        <span className={`change-kind change-kind--${action.toLowerCase()}`}>
                          {t(action)}
                        </span>
                        <ChevronDown className="apply-preview-file-change__chevron" size={15} strokeWidth={2.2} aria-hidden="true" />
                      </summary>
                      <DiffViewer path={change.path} diff={change.diff} />
                    </details>
                  );
                })}
                {group.id === "cleanup"
                  ? sharedPreparations.map((preparation) => (
                      <article className="apply-preview-change-row" role="listitem" key={`${preparation.skillKey}:${preparation.libraryId}`}>
                        <span className="apply-preview-change-row__identity">
                          <strong>{preparation.skillKey}</strong>
                          <small>
                            {preparation.disposition === "install"
                              ? t("Keep enabled as {{name}} after shared cleanup", {
                                  name: preparation.targetName
                                })
                              : t("Keep disabled after shared cleanup")}
                          </small>
                        </span>
                        <span className="change-kind change-kind--prepare">
                          {t("Prepare")}
                        </span>
                      </article>
                    ))
                  : null}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
};
