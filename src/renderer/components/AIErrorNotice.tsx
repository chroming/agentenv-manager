import { useI18n } from "../i18n";
import { Button, DiagnosticMessage, Notice } from "./ui";

export function AIErrorNotice({ message, onRetry, onConfigure, disabled = false }: {
  message: string; onRetry?(): void; onConfigure?(): void; disabled?: boolean;
}) {
  const { t } = useI18n();
  const configuration = /AI service returned HTTP (400|401|403|404|422)\b|Configure the AI service in Settings first/.test(message);
  const action = configuration && onConfigure ? onConfigure : onRetry;
  return <Notice tone="warning" role="alert" actions={action ? <Button disabled={disabled} onClick={action}>{t(configuration && onConfigure ? "Configure AI service" : "Retry")}</Button> : undefined}>
    <DiagnosticMessage message={message} />
  </Notice>;
}
