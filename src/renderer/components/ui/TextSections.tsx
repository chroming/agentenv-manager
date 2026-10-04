import type { HTMLAttributes, ReactNode } from "react";

interface SectionLabelProps extends HTMLAttributes<HTMLElement> {
  as?: "h3" | "h4";
  count?: number;
  icon?: ReactNode;
  tone?: "default" | "muted";
}

export const SectionLabel = ({
  as: Element = "h3", children, className = "", count, icon, tone = "default", ...props
}: SectionLabelProps) => (
  <Element {...props} className={`ui-section-label ui-section-label--${tone} ${className}`.trim()}>
    {icon ? <span className="ui-section-label__icon" aria-hidden="true">{icon}</span> : null}
    <span className="ui-section-label__text">{children}</span>
    {count !== undefined ? <>{" "}<span className="ui-section-label__count">{count}</span></> : null}
  </Element>
);

export const PathListPreview = ({
  paths, className = "", ...props
}: Omit<HTMLAttributes<HTMLPreElement>, "children"> & { paths: readonly string[] }) => (
  <pre {...props} className={`ui-path-list-preview selectable ${className}`.trim()}>{paths.join("\n")}</pre>
);
