import { formatBytes } from "../../formatBytes";
import { localeTag, useI18n } from "../../i18n";
import { OverflowTooltip } from "../OverflowTooltip";

type CatalogSortMetricProps = { label: string; detail?: string } & (
  { kind: "date"; value?: string | number } |
  { kind: "size" | "count"; value?: number }
);

export const CatalogSortMetric = ({ kind, label, value, detail }: CatalogSortMetricProps) => {
  const { locale, formatDate, t } = useI18n();
  const date = kind === "date" && value !== undefined ? new Date(value) : undefined;
  const known = kind === "date" ? Boolean(date && Number.isFinite(date.getTime()))
    : typeof value === "number" && Number.isFinite(value) && value >= 0;
  const display = !known ? t("Unavailable") : kind === "date"
    ? date!.toLocaleString(localeTag(locale), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : kind === "size" ? formatBytes(value as number) : (value as number).toLocaleString(localeTag(locale));
  const fullValue = known && date ? formatDate(date) : display;
  return <OverflowTooltip className="ui-catalog-sort-metric" ariaLabel={`${label}: ${fullValue}`}
    displayText={display} text={[`${label}: ${fullValue}`, detail].filter(Boolean).join("\n")} />;
};
