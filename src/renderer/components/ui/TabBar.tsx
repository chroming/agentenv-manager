import type { KeyboardEvent, ReactNode } from "react";

interface TabBarOption<T extends string> {
  disabled?: boolean;
  label: ReactNode;
  value: T;
}

interface TabBarProps<T extends string> {
  className?: string;
  idPrefix?: string;
  label: string;
  onChange(value: T): void;
  options: readonly TabBarOption<T>[];
  panelId?: string;
  value: T;
}

export const TabBar = <T extends string>({
  className = "",
  idPrefix,
  label,
  onChange,
  options,
  panelId,
  value
}: TabBarProps<T>) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .filter((tab) => !tab.disabled);
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (currentIndex < 0 || tabs.length === 0) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.click();
    tabs[nextIndex]?.focus();
  };

  return (
    <div
      aria-label={label}
      className={`ui-tab-bar ${className}`.trim()}
      role="tablist"
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => (
        <button
          aria-controls={panelId}
          aria-selected={option.value === value}
          className={`ui-tab-bar__tab${option.value === value ? " is-selected" : ""}`}
          disabled={option.disabled}
          id={idPrefix ? `${idPrefix}-${option.value}` : undefined}
          key={option.value}
          role="tab"
          tabIndex={option.value === value ? 0 : -1}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};
