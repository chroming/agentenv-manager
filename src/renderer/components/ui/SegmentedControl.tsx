import { LoaderCircle } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

interface SegmentedControlOption<T extends string> {
  busy?: boolean;
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
  semantics?: "buttons" | "tabs";
  value?: T;
}

export const SegmentedControl = <T extends string>({
  className = "",
  disabled = false,
  label,
  onChange,
  options,
  semantics = "buttons",
  value
}: SegmentedControlProps<T>) => {
  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (semantics !== "tabs" || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']:not(:disabled)"));
    if (tabs.length === 0) return;
    const currentIndex = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (currentIndex + 1) % tabs.length
          : (currentIndex - 1 + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <div
      aria-label={label}
      aria-orientation={semantics === "tabs" ? "horizontal" : undefined}
      className={`ui-segmented-control ${className}`.trim()}
      role={semantics === "tabs" ? "tablist" : "group"}
      onKeyDown={moveTabFocus}
    >
      {options.map((option) => (
        <button
          aria-busy={option.busy || undefined}
          aria-pressed={semantics === "buttons" ? option.value === value : undefined}
          aria-selected={semantics === "tabs" ? option.value === value : undefined}
          className={`ui-segmented-control__option${option.value === value ? " is-selected" : ""}`}
          disabled={disabled || option.disabled || option.busy}
          key={option.value}
          role={semantics === "tabs" ? "tab" : undefined}
          tabIndex={semantics === "tabs" ? option.value === value ? 0 : -1 : undefined}
          type="button"
          onClick={() => onChange(option.value)}
        >
          <span className="ui-segmented-control__stack">
            <span className="ui-segmented-control__label">{option.label}</span>
            <span className="ui-segmented-control__busy" aria-hidden="true">
              <LoaderCircle className={option.busy ? "is-spinning" : undefined} />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};
