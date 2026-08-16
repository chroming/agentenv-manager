import { forwardRef, type HTMLAttributes } from "react";
import { ControlDensityProvider, type ControlDensity } from "./controlDensity";

interface ControlGroupProps extends HTMLAttributes<HTMLDivElement> {
  density?: ControlDensity;
}

export const ControlGroup = forwardRef<HTMLDivElement, ControlGroupProps>(
  ({ children, className = "", density = "default", ...props }, ref) => (
    <ControlDensityProvider density={density}>
      <div
        ref={ref}
        role="group"
        {...props}
        className={`ui-control-group ui-control-group--${density} ${className}`.trim()}
        data-control-density={density}
      >
        {children}
      </div>
    </ControlDensityProvider>
  )
);

ControlGroup.displayName = "ControlGroup";
