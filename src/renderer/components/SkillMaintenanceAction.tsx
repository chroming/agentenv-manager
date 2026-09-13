import { CircleArrowUp, SearchCheck } from "lucide-react";
import { useI18n } from "../i18n";
import { Button, IconButton } from "./ui";

export const SkillMaintenanceAction = ({ action, scope = "skills", busy, disabled, onClick, label, className = "" }: {
  action: "check" | "update";
  scope?: "skills" | "sources" | "profile";
  className?: string;
  busy?: boolean;
  disabled?: boolean;
  onClick(): void;
  label?: string;
}) => {
  const { t } = useI18n();
  const checking = action === "check";
  const text = t(checking ? "Check updates" : "Update all");
  if (checking) return <IconButton label={label ?? text} busy={busy} disabled={disabled} onClick={onClick}
    title={scope === "profile" ? label ?? text : t(scope === "sources" ? "Check all monitored sources, regardless of filters." : "Check all monitored Skills in this view, regardless of filters.")}>
    <SearchCheck size={16} />
  </IconButton>;
  return <Button aria-label={label ?? text} className={`library-toolbar-action ${className}`} variant={checking ? "ghost" : "secondary"}
    busy={busy} busyLabel={text} disabled={disabled}
    icon={checking ? <SearchCheck size={15} strokeWidth={2.2} /> : <CircleArrowUp size={15} strokeWidth={2.2} />}
    title={scope === "profile" ? label ?? text : checking ? t(scope === "sources" ? "Check all monitored sources, regardless of filters." : "Check all monitored Skills in this view, regardless of filters.") : t("Review all available updates in this view, regardless of filters.")}
    onClick={onClick}>{text}</Button>;
};
