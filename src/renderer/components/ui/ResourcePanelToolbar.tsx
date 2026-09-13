import { useContext, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { ControlDensityProvider } from "./controlDensity";
import { ResourceHeadingActionsContext } from "./resourceHeadingActions";

export interface ResourcePanelToolbarProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "embedded" | "flush" | "catalog";
  placement?: "panel" | "heading";
}

export const ResourcePanelToolbar = ({
  children,
  className = "",
  variant = "default",
  placement = "panel",
  ...props
}: ResourcePanelToolbarProps) => {
  const heading = useContext(ResourceHeadingActionsContext);
  const toolbar = (
  <ControlDensityProvider density={variant === "catalog" ? "default" : "compact"}>
    <div
      {...props}
      className={`ui-resource-panel-toolbar ui-resource-panel-toolbar--${placement === "heading" ? "heading" : variant} ${className}`.trim()}
      role="toolbar"
    >
      {children}
    </div>
  </ControlDensityProvider>
  );
  return placement === "heading" && heading ? createPortal(toolbar, heading) : toolbar;
};
