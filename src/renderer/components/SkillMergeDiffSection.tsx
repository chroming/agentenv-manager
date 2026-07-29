import { CheckCircle2, Maximize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  SkillMergeComparison,
  SkillMergePreviewEntry
} from "../../shared/types";
import { useI18n } from "../i18n";
import { DiffViewer } from "./DiffViewer";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";
import { Button } from "./ui";

interface SkillMergeDiffSectionProps {
  comparison?: SkillMergeComparison;
  compareEntries: SkillMergePreviewEntry[];
  compareId: string;
  keepId: string;
  onCompareChange(id: string): void;
  onExpandedChange(expanded: boolean): void;
}

export const SkillMergeDiffSection = ({
  comparison,
  compareEntries,
  compareId,
  keepId,
  onCompareChange,
  onExpandedChange
}: SkillMergeDiffSectionProps) => {
  const { t } = useI18n();
  const expandPreviewRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const changes = comparison?.changes ?? [];

  useEffect(() => {
    onExpandedChange(expanded);
    return () => onExpandedChange(false);
  }, [expanded, onExpandedChange]);

  return (
    <>
      <section className="skill-merge-diff" aria-label={t("Skill differences")}>
        <header>
          <div>
            <strong>{t("Compare content")}</strong>
            <span>{keepId}</span>
          </div>
          <div className="skill-merge-diff__actions">
            {compareEntries.length > 1 ? (
              <select
                aria-label={t("Compare with")}
                value={compareId}
                onChange={(event) => onCompareChange(event.target.value)}
              >
                {compareEntries.map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.id}</option>
                ))}
              </select>
            ) : (
              <span>{compareId}</span>
            )}
            {changes.length > 0 ? (
              <Button
                ref={expandPreviewRef}
                icon={<Maximize2 size={14} />}
                size="compact"
                variant="ghost"
                onClick={() => setExpanded(true)}
              >
                {t("Expand preview")}
              </Button>
            ) : null}
          </div>
        </header>
        {changes.length > 0 ? (
          <div className="diff-list">
            {changes.map((change) => (
              <div className="diff-file" key={change.path}>
                <div className="diff-file-meta"><strong>{change.path}</strong></div>
                <DiffViewer path={change.path} diff={change.diff} />
              </div>
            ))}
          </div>
        ) : (
          <div className="skill-merge-identical">
            <CheckCircle2 size={16} strokeWidth={2.2} />
            <span>{t("No file changes")}</span>
          </div>
        )}
      </section>
      <DiffWorkspaceDialog
        changes={changes}
        open={expanded}
        returnFocusRef={expandPreviewRef}
        title={t("Compare content")}
        onClose={() => setExpanded(false)}
      />
    </>
  );
};
