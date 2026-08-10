import type { CSSProperties, Ref } from "react";
import { Columns2, Copy, History, RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { ActionMenu, ActionMenuItem } from "./ui";

interface ProfileActionsMenuProps {
  className?: string;
  disabled?: boolean;
  menuRef?: Ref<HTMLDivElement>;
  compareDisabled?: boolean;
  compareDescription?: string;
  appliedRestoreAvailable?: boolean;
  appliedRestoreDescription?: string;
  onCompare?(): void;
  onDelete(): void;
  onDuplicate(): void;
  onOpenRecovery?(): void;
  onRestoreLastApplied?(): void;
  style?: CSSProperties;
}

export const ProfileActionsMenu = ({
  className = "",
  disabled = false,
  menuRef,
  compareDisabled = false,
  compareDescription,
  appliedRestoreAvailable = false,
  appliedRestoreDescription,
  onCompare,
  onDelete,
  onDuplicate,
  onOpenRecovery,
  onRestoreLastApplied,
  style
}: ProfileActionsMenuProps) => {
  const { t } = useI18n();
  return (
    <ActionMenu
      ariaLabel={t("Profile actions")}
      className={`profile-actions-menu${className ? ` ${className}` : ""}`}
      menuRef={menuRef}
      style={style}
    >
      {onCompare ? <ActionMenuItem
        disabled={disabled || compareDisabled}
        title={compareDescription}
        onClick={onCompare}
      >
        <Columns2 size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("Compare")}</span>
      </ActionMenuItem> : null}
      {onRestoreLastApplied ? <ActionMenuItem
        disabled={disabled || !appliedRestoreAvailable}
        title={appliedRestoreDescription}
        onClick={onRestoreLastApplied}
      >
        <RotateCcw size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("Restore last applied")}</span>
      </ActionMenuItem> : null}
      {onOpenRecovery ? <ActionMenuItem disabled={disabled} onClick={onOpenRecovery}>
        <History size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("Profile Recovery")}</span>
      </ActionMenuItem> : null}
      <ActionMenuItem disabled={disabled} onClick={onDuplicate}>
        <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("Duplicate Profile")}</span>
      </ActionMenuItem>
      <ActionMenuItem
        disabled={disabled}
        tone="danger"
        onClick={onDelete}
      >
        <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("Delete Profile")}</span>
      </ActionMenuItem>
    </ActionMenu>
  );
};
