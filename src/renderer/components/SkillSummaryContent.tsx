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
  const items = [...summary.items].sort((a, b) => Number(b.category === "security") - Number(a.category === "security"));
  return <div className="skill-summary-content">
    <p>{summary.overview}</p>
    {items.slice(0, 3).map((item, index) => item.category === "security"
      ? <Notice key={index} tone="warning" title={t("Security concerns")}>{item.fact}</Notice>
      : <p key={index}>{item.fact}</p>)}
    {summary.coverage === "partial" ? <Notice tone="warning" title={t("Partial analysis")}>
      {t("Files not analyzed")}: {summary.omittedPaths.join(", ")}
    </Notice> : null}
    <details>
    <summary>{t("Details")}{items.length > 3 ? ` · ${items.length}` : ""}</summary>
    <div className="skill-summary-content">
    <p className="muted">{t("AI-generated")} · {summary.model} · {new Date(summary.generatedAt).toLocaleString()}</p>
    {categories.map(([category, label]) => {
      const items = summary.items.filter((item) => item.category === category);
      if (!items.length) return null;
      const content = <ul>{items.map((item, index) => <li key={index}>
        <p>{item.fact}</p>
        {item.implication ? <p className="muted">{item.implication}</p> : null}
        <div className="skill-summary-files">{item.paths.map((path) => onViewFile
          ? <TextAction key={path} onClick={() => onViewFile(path)}>{path}</TextAction>
          : <code key={path}>{path}</code>)}</div>
      </li>)}</ul>;
      return category === "security"
        ? <Notice key={category} tone="warning" title={t(label)}>{content}</Notice>
        : <section key={category}><h4>{t(label)}</h4>{content}</section>;
    })}
    <p className="muted">{t("AI review is not a safety guarantee. Check the original diff when in doubt.")}</p>
    {summary.redacted ? <p className="muted">{t("Possible credentials were redacted before analysis.")}</p> : null}
    {summary.usage ? <p className="muted">
      {t("Tokens")}: {summary.usage.inputTokens ?? t("Unavailable")} / {summary.usage.outputTokens ?? t("Unavailable")}
    </p> : null}
    </div>
    </details>
  </div>;
};
