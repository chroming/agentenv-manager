import type { HTMLAttributes, ReactNode } from "react";

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: BadgeTone;
}

export const Badge = ({ children, className = "", tone = "neutral", ...props }: BadgeProps) => (
  <span {...props} className={`ui-badge ui-badge--${tone} ${className}`.trim()}>
    {children}
  </span>
);
