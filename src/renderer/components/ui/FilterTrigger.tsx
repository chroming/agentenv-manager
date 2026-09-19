import { forwardRef, type ComponentProps } from "react";
import { IconButton } from "./IconButton";
import { useI18n } from "../../i18n";

type FilterTriggerProps = ComponentProps<typeof IconButton> & { activeCount?: number };

export const FilterTrigger = forwardRef<HTMLButtonElement, FilterTriggerProps>(
  ({ activeCount = 0, label, className = "", children, ...props }, ref) => {
    const { t } = useI18n();
    return <span className={`ui-filter-popover${activeCount > 0 ? " has-active-filters" : ""}`}>
      <IconButton variant="ghost" {...props} active={activeCount > 0} ref={ref} className={`ui-filter-popover__trigger ${className}`}
        label={activeCount > 0 ? `${label}, ${t("{{count}} active filters", { count: activeCount })}` : label}>
        {children}
      </IconButton>
      {activeCount > 0 ? <span className="ui-filter-popover__indicator" aria-hidden="true" /> : null}
    </span>;
  }
);
FilterTrigger.displayName = "FilterTrigger";
