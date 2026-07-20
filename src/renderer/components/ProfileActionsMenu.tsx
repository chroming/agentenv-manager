import { Copy, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";

interface ProfileActionsMenuProps {
  disabled?: boolean;
  onDelete(): void;
  onDuplicate(): void;
}

export const ProfileActionsMenu = ({
  disabled = false,
  onDelete,
  onDuplicate
}: ProfileActionsMenuProps) => {
  const { t } = useI18n();
  return (
    <div
      className="profile-actions-menu ui-action-menu"
      role="menu"
      aria-label={t("Profile actions")}
    >
      <button disabled={disabled} type="button" role="menuitem" onClick={onDuplicate}>
        <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("Duplicate profile")}</span>
      </button>
      <button
        className="is-danger"
        disabled={disabled}
        type="button"
        role="menuitem"
        onClick={onDelete}
      >
        <Trash2 size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>{t("Delete profile")}</span>
      </button>
    </div>
  );
};
