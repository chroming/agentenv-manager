import { CircleArrowUp, SearchCheck } from "lucide-react";
import { useI18n } from "../i18n";
import { Button } from "./ui";

export const SkillMaintenanceAction = ({ action, scope = "skills", busy, disabled, onClick, label }: {
  action: "check" | "update";
  scope?: "skills" | "sources";
  busy?: boolean;
  disabled?: boolean;
  onClick(): void;
  label?: string;
}) => {
  const { t } = useI18n();
  const checking = action === "check";
  const text = t(checking ? "Check updates" : "Update all");
  return <Button aria-label={label ?? text} className="library-toolbar-action"
    busy={busy} busyLabel={text} disabled={disabled}
    icon={checking ? <SearchCheck size={15} strokeWidth={2.2} /> : <CircleArrowUp size={15} strokeWidth={2.2} />}
    title={checking ? t(scope === "sources" ? "Check all monitored sources, regardless of filters." : "Check all monitored Skills in this view, regardless of filters.") : t("Review all available updates in this view, regardless of filters.")}
    onClick={onClick}>{text}</Button>;
};
