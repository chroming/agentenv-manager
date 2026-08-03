import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useI18n } from "../i18n";

interface WindowTitlebarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar(): void;
}

export const WindowTitlebar = ({
  sidebarCollapsed,
  onToggleSidebar
}: WindowTitlebarProps) => {
  const { t } = useI18n();
  const sidebarLabel = t(sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  return (
    <div className="shell-titlebar">
      <div className="shell-titlebar__drag-region" aria-hidden="true" />
      <button
        className="shell-sidebar-toggle"
        type="button"
        aria-label={sidebarLabel}
        title={sidebarLabel}
        onClick={onToggleSidebar}
      >
        {sidebarCollapsed ? (
          <PanelLeftOpen size={17} strokeWidth={2.1} aria-hidden="true" />
        ) : (
          <PanelLeftClose size={17} strokeWidth={2.1} aria-hidden="true" />
        )}
      </button>
    </div>
  );
};
