import type { HTMLAttributes } from "react";

export type ResourcePanelToolbarProps = HTMLAttributes<HTMLDivElement>;

export const ResourcePanelToolbar = ({
  children,
  className = "",
  ...props
}: ResourcePanelToolbarProps) => (
  <div
    {...props}
    className={`ui-resource-panel-toolbar ${className}`.trim()}
    role="toolbar"
  >
    {children}
  </div>
);
