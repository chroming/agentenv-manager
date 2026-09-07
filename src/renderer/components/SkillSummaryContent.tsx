import type { SkillSummary, SkillSummaryCategory } from "../../shared/skillSummaries";
import { useI18n } from "../i18n";
import { Notice, TextAction } from "./ui";

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
  const finding = (item: SkillSummary["items"][number], index: number) => <div key={index}>
    <dt>{t(categories.find(([category]) => category === item.category)![1])}</dt>
    <dd>{item.category === "security"
      ? <Notice tone="warning">{item.fact}{item.implication ? <p>{item.implication}</p> : null}</Notice>
      : <><p>{item.fact}</p>{item.implication ? <p className="muted">{item.implication}</p> : null}</>}
      {evidence(item.paths)}
    </dd>
  </div>;
  return <div className="skill-summary-content">
    <p>{summary.overview}</p>
    <dl className="skill-summary-findings">
    {items.slice(0, 3).map(finding)}
    </dl>
    {summary.coverage === "partial" ? <Notice tone="warning" title={t("Partial analysis")}>
      {t("Some changed content was not analyzed. Review the coverage in Details.")}
    </Notice> : null}
    <details>
    <summary>{items.length > 3 ? t("More findings ({{count}})", { count: items.length - 3 }) : t("Details")}</summary>
    <div className="skill-summary-content">
    <p className="muted">{t("AI-generated")} · {summary.model} · {new Date(summary.generatedAt).toLocaleString()}</p>
    {items.length > 3 ? <dl className="skill-summary-findings">{items.slice(3).map(finding)}</dl> : null}
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
