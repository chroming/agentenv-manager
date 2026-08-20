import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface TagChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export const TagChip = forwardRef<HTMLButtonElement, TagChipProps>(({
  children,
  className = "",
  type = "button",
  ...props
}, ref) => (
  <button ref={ref} {...props} className={className} type={type}>
    {children}
  </button>
));

TagChip.displayName = "TagChip";
