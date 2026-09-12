import type { ReactNode } from "react";
import { InfoTip } from "./InfoTip";

interface SettingsPreferenceRowProps {
  controlWidth?: "standard" | "intrinsic";
  className?: string;
  control: ReactNode;
  description?: ReactNode;
  help?: string;
  label: ReactNode;
}

export const SettingsPreferenceRow = ({
  controlWidth = "standard",
  className = "",
  control,
  description,
  help,
  label
}: SettingsPreferenceRowProps) => (
  <div className={`settings-preference-row${controlWidth === "intrinsic" ? " settings-preference-row--intrinsic" : ""} ${className}`.trim()}>
    <span className="settings-preference-copy">
      <strong>{label}{help ? <InfoTip label={help} /> : null}</strong>
      {description ? <small>{description}</small> : null}
    </span>
    <span className="settings-preference-control">{control}</span>
  </div>
);
