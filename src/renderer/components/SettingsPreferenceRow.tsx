import type { ReactNode } from "react";

interface SettingsPreferenceRowProps {
  className?: string;
  control: ReactNode;
  description: ReactNode;
  label: ReactNode;
}

export const SettingsPreferenceRow = ({
  className = "",
  control,
  description,
  label
}: SettingsPreferenceRowProps) => (
  <div className={`settings-preference-row ${className}`.trim()}>
    <span className="settings-preference-copy">
      <strong>{label}</strong>
      <small>{description}</small>
    </span>
    <span className="settings-preference-control">{control}</span>
  </div>
);
