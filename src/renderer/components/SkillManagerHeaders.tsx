import { X } from "lucide-react";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import { IconButton, RefreshAction } from "./ui";

export const SkillManagerDrawerHeader = ({
  title,
  help,
  busy,
  refreshing,
  onRefresh,
  onClose
}: {
  title: string;
  help: string;
  busy: boolean;
  refreshing: boolean;
  onRefresh(): void;
  onClose(): void;
}) => {
  const { t } = useI18n();
  return <div className="library-drawer__header">
    <div><strong>{title}<InfoTip label={help} /></strong></div>
    <div className="library-drawer__actions">
      <RefreshAction
        className="library-drawer__refresh"
        ariaLabel={t("Refresh local skills")}
        busy={refreshing}
        disabled={busy || refreshing}
        label={t("Refresh")}
        onRefresh={onRefresh}
      />
      <IconButton
        label={t("Close library tool")}
        disabled={busy || refreshing}
        onClick={onClose}
        variant="ghost"
      >
        <X size={16} strokeWidth={2.2} />
      </IconButton>
    </div>
  </div>;
};

export const SkillManagementScopeHeader = ({
  title,
  summary
}: {
  title: string;
  summary: string;
}) => {
  const { t } = useI18n();
  return <div className="cleanup-section-heading">
    <div>
      <div className="resource-heading">
        {title}
        <InfoTip label={t("Each group shows one Skill, its detected copies, and the next safe cleanup action.")} />
      </div>
      <small>{summary || t("No cleanup actions needed")}</small>
    </div>
  </div>;
};
