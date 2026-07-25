import type { KeyboardEvent } from "react";
import { useI18n } from "../i18n";

export type ProfileResourcePolicy = "apply-profile" | "leave-unchanged";

interface ProfileResourcePolicyControlProps {
  disabled?: boolean;
  label: string;
  status?: string;
  value: ProfileResourcePolicy;
  onChange(value: ProfileResourcePolicy): void;
}

const policyOptions: Array<{
  label: "Use Profile" | "Keep Agent";
  value: ProfileResourcePolicy;
}> = [
  { label: "Use Profile", value: "apply-profile" },
  { label: "Keep Agent", value: "leave-unchanged" }
];

export const ProfileResourcePolicyControl = ({
  disabled = false,
  label,
  status,
  value,
  onChange
}: ProfileResourcePolicyControlProps) => {
  const { t } = useI18n();
  const focusOption = (
    event: KeyboardEvent<HTMLDivElement>,
    nextValue: ProfileResourcePolicy
  ) => {
    const option = event.currentTarget.querySelector<HTMLButtonElement>(
      `[data-policy-value="${nextValue}"]`
    );
    option?.focus();
    if (nextValue !== value) onChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextValue: ProfileResourcePolicy | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home") {
      nextValue = "apply-profile";
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End") {
      nextValue = "leave-unchanged";
    }
    if (!nextValue) return;
    event.preventDefault();
    focusOption(event, nextValue);
  };

  if (disabled) {
    return (
      <span
        className="profile-resource-policy__status"
        role="status"
        aria-label={label}
      >
        {status ?? t("Agent controlled")}
      </span>
    );
  }

  return (
    <div
      className={`profile-resource-policy${
        value === "leave-unchanged" ? " is-keep-agent" : ""
      }`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
    >
      {policyOptions.map((option) => {
        const selected = option.value === value;
        return (
          <button
            className={`profile-resource-policy__option${selected ? " is-selected" : ""}`}
            type="button"
            role="radio"
            aria-checked={selected}
            data-policy-value={option.value}
            key={option.value}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
          >
            {t(option.label)}
          </button>
        );
      })}
    </div>
  );
};
