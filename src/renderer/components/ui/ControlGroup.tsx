import { forwardRef, type HTMLAttributes } from "react";

export const ControlGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className = "", ...props }, ref) => (
    <div ref={ref} role="group" {...props} className={`ui-control-group ${className}`.trim()} />
  )
);

ControlGroup.displayName = "ControlGroup";
