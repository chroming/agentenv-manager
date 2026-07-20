import type { ReactNode } from "react";
import { HoverDetail } from "./HoverDetail";

interface OverflowTooltipProps {
  ariaLabel?: string;
  className: string;
  displayText?: string;
  displayContent?: ReactNode;
  focusable?: boolean;
  preferredPlacement?: "top" | "bottom";
  text: string;
  tooltipClassName?: string;
}

export const OverflowTooltip = ({
  ariaLabel,
  className,
  displayText,
  displayContent,
  focusable = true,
  preferredPlacement,
  text,
  tooltipClassName = ""
}: OverflowTooltipProps) => {
  return (
    <HoverDetail
      ariaLabel={ariaLabel}
      className={className}
      content={text}
      focusable={focusable}
      popoverClassName={`skill-description-tooltip${tooltipClassName ? ` ${tooltipClassName}` : ""}`}
      preferredPlacement={preferredPlacement}
    >
      {displayContent ?? displayText ?? text}
    </HoverDetail>
  );
};
