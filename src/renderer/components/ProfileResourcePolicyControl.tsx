import type { KeyboardEvent } from "react";
import type { ProfileResourceMode } from "../../shared/types";
import { useI18n } from "../i18n";

export type ProfileResourcePolicy = ProfileResourceMode;

interface ProfileResourcePolicyControlProps {
  disabled?: boolean;
  label: string;
  status?: string;
  value: ProfileResourcePolicy;
  onChange(value: ProfileResourcePolicy): void;
}

const policyOptions: Array<{
  label: "Apply" | "Disable" | "Don't manage";
  value: ProfileResourcePolicy;
}> = [
  { label: "Apply", value: "manage" },
  { label: "Disable", value: "disable" },
  { label: "Don't manage", value: "ignore" }
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
    const currentIndex = policyOptions.findIndex((option) => option.value === value);
    if (event.key === "Home") {
      nextValue = policyOptions[0].value;
    }
    if (event.key === "End") {
      nextValue = policyOptions.at(-1)?.value;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextValue =
        policyOptions[(currentIndex - 1 + policyOptions.length) % policyOptions.length]
          .value;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextValue = policyOptions[(currentIndex + 1) % policyOptions.length].value;
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
      className={`profile-resource-policy is-${value}`}
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
