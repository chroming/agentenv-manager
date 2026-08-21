import type { ReactNode } from "react";
import { ChoiceInput } from "./ui";

interface ResourcePickerOptionProps {
  checked: boolean;
  description?: ReactNode;
  icon: ReactNode;
  metadata?: ReactNode;
  name?: string;
  onChange(): void;
  title: ReactNode;
  type?: "checkbox" | "radio";
}

export const ResourcePickerOption = ({
  checked,
  description,
  icon,
  metadata,
  name,
  onChange,
  title,
  type = "checkbox"
}: ResourcePickerOptionProps) => (
  <label className={`resource-picker-option${checked ? " is-selected" : ""}`}>
    <ChoiceInput
      aria-label={typeof title === "string" ? title : undefined}
      checked={checked}
      name={name}
      type={type}
      onChange={onChange}
    />
    <span className="resource-picker-option__content">
      <span className="resource-picker-option__icon" aria-hidden="true">{icon}</span>
      <span className="resource-picker-option__main">
        <strong>{title}</strong>
        {description ? <span className="resource-picker-option__description">{description}</span> : null}
        {metadata ? <span className="resource-picker-option__metadata">{metadata}</span> : null}
      </span>
    </span>
  </label>
);
