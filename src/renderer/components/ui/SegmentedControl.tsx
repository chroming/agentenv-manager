import type { ReactNode } from "react";

interface SegmentedControlOption<T extends string> {
  disabled?: boolean;
  label: ReactNode;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange(value: T): void;
  options: readonly SegmentedControlOption<T>[];
  value: T;
}

export const SegmentedControl = <T extends string>({
  className = "",
  disabled = false,
  label,
  onChange,
  options,
  value
}: SegmentedControlProps<T>) => (
  <div className={`ui-segmented-control ${className}`.trim()} role="group" aria-label={label}>
    {options.map((option) => (
      <button
        aria-pressed={option.value === value}
        className={`ui-segmented-control__option${option.value === value ? " is-selected" : ""}`}
        disabled={disabled || option.disabled}
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);
