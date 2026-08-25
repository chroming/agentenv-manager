import type { HTMLAttributes } from "react";
import { ControlDensityProvider } from "./controlDensity";

export interface ResourcePanelToolbarProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "embedded";
}

export const ResourcePanelToolbar = ({
  children,
  className = "",
  variant = "default",
  ...props
}: ResourcePanelToolbarProps) => (
  <ControlDensityProvider density="compact">
    <div
      {...props}
      className={`ui-resource-panel-toolbar ui-resource-panel-toolbar--${variant} ${className}`.trim()}
      role="toolbar"
    >
      {children}
    </div>
  </ControlDensityProvider>
);
