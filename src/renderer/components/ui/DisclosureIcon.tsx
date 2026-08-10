import { ChevronRight } from "lucide-react";

interface DisclosureIconProps {
  className?: string;
  open: boolean;
  size?: number;
}

export const DisclosureIcon = ({
  className = "",
  open,
  size = 15
}: DisclosureIconProps) => (
  <ChevronRight
    aria-hidden="true"
    className={`ui-disclosure-icon${open ? " is-open" : ""} ${className}`.trim()}
    size={size}
    strokeWidth={2.2}
  />
);
