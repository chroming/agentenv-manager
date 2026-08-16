import type { HTMLAttributes } from "react";
import { ControlDensityProvider } from "./controlDensity";

export type ResourcePanelToolbarProps = HTMLAttributes<HTMLDivElement>;

export const ResourcePanelToolbar = ({
  children,
  className = "",
  ...props
}: ResourcePanelToolbarProps) => (
  <ControlDensityProvider density="compact">
    <div
      {...props}
      className={`ui-resource-panel-toolbar ${className}`.trim()}
      role="toolbar"
    >
      {children}
    </div>
  </ControlDensityProvider>
);
