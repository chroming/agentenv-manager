import type { AIResultQuality } from "../../shared/aiReliability";
import { useI18n } from "../i18n";
import { SyntaxCodePreview } from "./SyntaxCodePreview";
import { Button, Notice } from "./ui";

export function AIResponseNotice({ result, onRetrySave, busy = false }: { result: AIResultQuality; onRetrySave?(): void; busy?: boolean }) {
  const { t } = useI18n();
  const messages = [
    result.savePending ? t("Generated, but not saved on this device. Keep this window open and retry saving; this does not call the AI service again.") : "",
    result.responseIssues?.length ? result.responseIssues.includes("truncated") ? t("The service reached its output limit. This is only a partial result.")
        : result.responseIssues.includes("invalid-items") ? t("Some returned findings could not be displayed. Review the original response before deciding.")
        : t("Some findings could not be classified. They are kept for review, not treated as ordinary changes.") : ""
  ].filter(Boolean);
  return messages.length ? <Notice tone="warning" role="status" actions={result.savePending && onRetrySave
    ? <Button busy={busy} disabled={busy} onClick={onRetrySave}>{t("Retry saving")}</Button> : undefined}>{messages.join(" ")}</Notice> : null;
}

export function AIOriginalResponse({ result }: { result: AIResultQuality }) {
  const { t } = useI18n();
  return result.unparsedOutput ? <details className="ai-review-details"><summary>{t("Original AI response")}</summary>
      <SyntaxCodePreview path="response.json" code={result.unparsedOutput} />
    </details> : null;
}
