import type { CSSProperties, Ref } from "react";
import { Copy, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { ActionMenu } from "./ui";

interface ProfileActionsMenuProps {
  className?: string;
  disabled?: boolean;
  menuRef?: Ref<HTMLDivElement>;
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
    <ActionMenu
      ariaLabel={t("Profile actions")}
      className={`profile-actions-menu${className ? ` ${className}` : ""}`}
      menuRef={menuRef}
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
    </ActionMenu>
  );
};
