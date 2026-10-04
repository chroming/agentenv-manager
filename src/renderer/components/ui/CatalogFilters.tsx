import type { ReactNode } from "react";
import { ListFilter } from "lucide-react";
import { useI18n } from "../../i18n";
import { FilterPopover } from "./FilterPopover";

export function CatalogFilters({ count, summary, children }: {
  count: number;
  summary?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return <FilterPopover label={t("Filters")} activeCount={count}
    summary={count === 1 ? summary : undefined} icon={<ListFilter size={15} />}>
    {children}
  </FilterPopover>;
}
