import type { HTMLAttributes } from "react";

export const ControlGroup = ({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div role="group" {...props} className={`ui-control-group ${className}`.trim()} />
);
