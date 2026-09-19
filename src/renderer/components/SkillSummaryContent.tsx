import type { SkillSummary, SkillSummaryCategory } from "../../shared/skillSummaries";
import { useI18n } from "../i18n";
import { Notice, TextAction } from "./ui";
import { AIReviewFindings, splitAIReviewFindings } from "./AIReviewFindings";

const categories: Array<[SkillSummaryCategory, string]> = [
  ["important", "Important changes"], ["usage", "Usage impact"],
  ["security", "Security concerns"], ["other", "Other changes"]
];

export const SkillSummaryContent = ({ summary, onViewFile }: {
  summary: SkillSummary; onViewFile?(path: string): void;
}) => {
  const { t } = useI18n();
  const priority = { security: 0, usage: 1, important: 2, other: 3 };
  const items = [...summary.items].sort((a, b) => priority[a.category] - priority[b.category]);
  const evidence = (paths: string[]) => <div className="skill-summary-files">{paths.map((path) => onViewFile
    ? <TextAction key={path} onClick={() => onViewFile(path)}>{path}</TextAction>
    : <code key={path}>{path}</code>)}</div>;
  const { visible, remaining } = splitAIReviewFindings(items.map((item) => ({
    detail: item.fact, suggestion: item.implication, risk: item.category === "security",
    note: item.evidenceStatus === "unverified" ? <p className="muted">{t("File references could not be verified. Check this finding against the original diff.")}</p> : undefined
  })));
  return <div className="skill-summary-content">
    <p className="ai-review-overview">{summary.overview}</p>
    <AIReviewFindings items={visible} />
    {summary.coverage === "partial" ? <Notice tone="warning" title={t("Partial analysis")}>
      {t("Some changed content was not analyzed. Review the coverage in Details.")}
    </Notice> : null}
    <details className="ai-review-details">
    <summary>{remaining.length ? t("More findings ({{count}})", { count: remaining.length }) : t("Evidence and scope")}</summary>
    <div className="skill-summary-content">
    <p className="muted">{t("AI-generated")} · {summary.model} · {new Date(summary.generatedAt).toLocaleString()}</p>
    <AIReviewFindings items={remaining} />
    <ol className="ai-review-evidence">{items.map((item, index) => <li key={index}>
      <span className="muted">{t(categories.find(([category]) => category === item.category)![1])}</span>
      <p>{item.fact}</p>
      {evidence(item.paths)}
    </li>)}</ol>
    {summary.changeInventory ? <ul>{summary.changeInventory.map((file) => {
      const actionLabel = file.action === "added" ? "Added" : file.action === "removed" ? "Removed" : "Modified";
      const coverageLabel = file.coverage === "full" ? "Analyzed" : file.coverage === "partial" ? "Partial analysis" : "Not analyzed";
      return <li key={file.path}><code>{file.path}</code> · {t(actionLabel)} · {t(coverageLabel)}</li>;
    })}</ul> : summary.omittedPaths.length ? <p>{t("Files not analyzed")}: {summary.omittedPaths.join(", ")}</p> : null}
    {summary.timings ? <p className="muted">{t("Preparing")}: {summary.timings.preparationMs} ms · {t("AI response")}: {(summary.timings.requestMs / 1000).toFixed(1)} s</p> : null}
    <p className="muted">{t("AI review is not a safety guarantee. Check the original diff when in doubt.")}</p>
    {summary.redacted ? <p className="muted">{t("Possible credentials were redacted before analysis.")}</p> : null}
    {summary.usage ? <p className="muted">
      {t("Tokens")}: {summary.usage.inputTokens ?? t("Unavailable")} / {summary.usage.outputTokens ?? t("Unavailable")}
    </p> : null}
    </div>
    </details>
  </div>;
};
