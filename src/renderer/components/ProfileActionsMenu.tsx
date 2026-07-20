import { Copy, Trash2 } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { useI18n } from "../i18n";

interface ProfileActionsMenuProps {
  className?: string;
  disabled?: boolean;
  menuRef?: RefObject<HTMLDivElement | null>;
  onDelete(): void;
  onDuplicate(): void;
  style?: CSSProperties;
}

export const ProfileActionsMenu = ({
  className = "",
  disabled = false,
  menuRef,
  onDelete,
  onDuplicate,
  style
}: ProfileActionsMenuProps) => {
  const { t } = useI18n();
  return (
    <div
      className={`profile-actions-menu ui-action-menu${className ? ` ${className}` : ""}`}
      ref={menuRef}
      role="menu"
      aria-label={t("Profile actions")}
      style={style}
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
