import { Info } from "lucide-react";

interface InfoTipProps {
  label: string;
}

export const InfoTip = ({ label }: InfoTipProps) => (
  <span className="info-tip" tabIndex={0} aria-label={label}>
    <Info size={14} strokeWidth={2.2} aria-hidden="true" />
    <span className="info-tip__bubble" role="tooltip">
      {label}
    </span>
  </span>
);
