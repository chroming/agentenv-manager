import { Info } from "lucide-react";
import { HoverDetail } from "./HoverDetail";

interface InfoTipProps {
  label: string;
}

export const InfoTip = ({ label }: InfoTipProps) => {
  return (
    <HoverDetail
      align="center"
      ariaLabel={label}
      className="info-tip"
      content={label}
      maxWidth={320}
      popoverClassName="info-tip__bubble info-tip__bubble--portal"
      preferredPlacement="top"
      showArrow
    >
      <Info size={14} strokeWidth={2.2} aria-hidden="true" />
    </HoverDetail>
  );
};
