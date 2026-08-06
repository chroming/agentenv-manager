import type { CSSProperties, Ref } from "react";
import { Copy, Trash2 } from "lucide-react";
import { useI18n } from "../i18n";
import { ActionMenu, ActionMenuItem } from "./ui";

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
