import type { ReactNode } from "react";
import { HoverDetail } from "./HoverDetail";

interface OverflowTooltipProps {
  ariaLabel?: string;
  className: string;
  displayText?: string;
  displayContent?: ReactNode;
  focusable?: boolean;
  id?: string;
  preferredPlacement?: "top" | "bottom";
  text: string;
  testId?: string;
  tooltipClassName?: string;
}

export const OverflowTooltip = ({
  ariaLabel,
  className,
  displayText,
  displayContent,
  focusable = true,
  id,
  preferredPlacement,
  text,
  testId,
  tooltipClassName = ""
}: OverflowTooltipProps) => {
  return (
    <HoverDetail
      ariaLabel={ariaLabel}
      className={className}
      content={text}
      focusable={focusable}
      id={id}
      popoverClassName={`skill-description-tooltip${tooltipClassName ? ` ${tooltipClassName}` : ""}`}
      preferredPlacement={preferredPlacement}
      testId={testId}
    >
      {displayContent ?? displayText ?? text}
    </HoverDetail>
  );
};
