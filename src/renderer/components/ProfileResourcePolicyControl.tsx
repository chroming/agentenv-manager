import { LockKeyhole } from "lucide-react";
import type { ProfileResourceMode } from "../../shared/types";
import { useI18n } from "../i18n";
import { SelectField } from "./ui";

export type ProfileResourcePolicy = ProfileResourceMode;

interface ProfileResourcePolicyControlProps {
  disabled?: boolean;
  label: string;
  status?: string;
  value: ProfileResourcePolicy;
  onChange(value: ProfileResourcePolicy): void;
}

const policyOptions: Array<{
  description:
    | "Apply this Profile's saved resources to the Agent"
    | "Remove this resource type from the Agent when applying"
    | "Leave this resource type exactly as it is in the Agent";
  label: "Use Profile" | "Turn off" | "Keep Agent";
  value: ProfileResourcePolicy;
}> = [
  {
    description: "Apply this Profile's saved resources to the Agent",
    label: "Use Profile",
    value: "manage"
  },
  {
    description: "Remove this resource type from the Agent when applying",
    label: "Turn off",
    value: "disable"
  },
  {
    description: "Leave this resource type exactly as it is in the Agent",
    label: "Keep Agent",
    value: "ignore"
  }
];

export const ProfileResourcePolicyControl = ({
  disabled = false,
  label,
  status,
  value,
  onChange
}: ProfileResourcePolicyControlProps) => {
  const { t } = useI18n();
  if (disabled) {
    return (
      <span
        className="profile-resource-policy__status"
        role="status"
        aria-label={label}
        title={status ?? t("Agent controlled")}
      >
        <LockKeyhole size={13} strokeWidth={2} aria-hidden="true" />
        {status ?? t("Agent controlled")}
      </span>
    );
  }

  const selectedOption = policyOptions.find((option) => option.value === value);
  return (
    <SelectField
      className={`profile-resource-policy is-${value}`}
      fieldClassName="profile-resource-policy-field"
      label={label}
      labelHidden
      title={selectedOption ? t(selectedOption.description) : undefined}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value as ProfileResourcePolicy)}
    >
      {policyOptions.map((option) => (
        <option key={option.value} value={option.value}>{t(option.label)}</option>
      ))}
    </SelectField>
  );
};
