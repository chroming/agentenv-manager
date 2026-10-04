import type { HTMLAttributes, ReactNode } from "react";
import { ControlDensityProvider } from "./controlDensity";

interface CatalogToolbarProps extends HTMLAttributes<HTMLDivElement> {
  layout?: "wide" | "pane";
  search: ReactNode;
  controls: ReactNode;
  actions?: ReactNode;
  context?: ReactNode;
}

export function CatalogToolbar({ layout = "wide", search, controls, actions, context,
  className = "", ...props }: CatalogToolbarProps) {
  return <ControlDensityProvider density="default">
    <div {...props} role="toolbar" className={`ui-catalog-toolbar ui-catalog-toolbar--${layout} ${className}`.trim()}>
      <div className="ui-catalog-toolbar__search">{search}</div>
      {context ? <div className="ui-catalog-toolbar__context">{context}</div> : null}
      <div className="ui-catalog-toolbar__controls">{controls}</div>
      {actions ? <div className="ui-catalog-toolbar__actions">{actions}</div> : null}
    </div>
  </ControlDensityProvider>;
}
