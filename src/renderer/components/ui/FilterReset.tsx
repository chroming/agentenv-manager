import { RotateCcw } from "lucide-react";
import { useI18n } from "../../i18n";
import { Button } from "./Button";

export function FilterReset({ disabled, onReset }: { disabled: boolean; onReset(): void }) {
  const { t } = useI18n();
  return <div className="ui-filter-reset">
    <Button size="default" variant="ghost" icon={<RotateCcw size={15} />} disabled={disabled} onClick={onReset}>
      {t("Clear filters")}
    </Button>
  </div>;
}
