import type { ReactNode } from "react";
import { ListFilter } from "lucide-react";
import { useI18n } from "../../i18n";
import { FilterPopover } from "../ui";

export function CatalogFilters({ count, summary, children }: {
  count: number;
  summary?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return <div className="catalog-filters">
    {count > 0 ? <span className="catalog-filters__summary">{count === 1 && summary ? summary : `${t("Filters")} · ${count}`}</span> : null}
    <FilterPopover label={t("Filters")} activeCount={count} icon={<ListFilter size={15} />}>
      {children}
    </FilterPopover>
  </div>;
}
