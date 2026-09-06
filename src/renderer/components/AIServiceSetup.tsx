import { useI18n } from "../i18n";
import { AIServiceForm } from "./SkillSummarySettings";
import { Button, Notice } from "./ui";

export const AIServiceSetup = ({ editing, onEditingChange, onSaved }: {
  editing: boolean; onEditingChange(editing: boolean): void; onSaved(): void;
}) => {
  const { t } = useI18n();
  return editing ? <AIServiceForm onCancel={() => onEditingChange(false)} onSaved={() => { onEditingChange(false); onSaved(); }} /> : (
    <Notice actions={<Button onClick={() => onEditingChange(true)}>{t("Configure AI service")}</Button>}>
      {t("Configure the AI service before generating. No request has been sent.")}
    </Notice>
  );
};
