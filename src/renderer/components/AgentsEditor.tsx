import { useId } from "react";
import { useI18n } from "../i18n";
import { InfoTip } from "./InfoTip";
import { OverflowTooltip } from "./OverflowTooltip";
import type { ProfileResourcePolicy } from "./ProfileResourcePolicyControl";

interface AgentsEditorProps {
  label: string;
  path?: string;
  policy: ProfileResourcePolicy;
  targetName: string;
  value: string;
  currentValue?: string;
  currentValueAvailable?: boolean;
  onChange(value: string): void;
}

export const AgentsEditor = ({
  label,
  path,
  policy,
  targetName,
  value,
  currentValue,
  currentValueAvailable = false,
  onChange
}: AgentsEditorProps) => {
  const { t } = useI18n();
  const editorId = useId();
  const help = policy === "ignore"
    ? t(
        "This content stays in the Profile. Applying to {{name}} leaves its instruction file unchanged.",
        { name: targetName }
      )
    : policy === "disable"
      ? t(
          "Applying the Profile clears this instruction file. New {{name}} sessions load the change; running conversations keep their current context.",
          { name: targetName }
        )
      : t(
          "Applying the Profile writes this file. New {{name}} sessions load changes; running conversations keep their current context.",
          { name: targetName }
      );
  const showingAgentState = policy === "ignore";
  const effectiveValue = policy === "manage"
    ? value
    : policy === "disable"
      ? ""
      : currentValue ?? "";
  const agentStateUnavailable = showingAgentState && !currentValueAvailable;

  return (
    <div className="field-block instruction-editor">
      <div className="instruction-editor__header">
        <label htmlFor={editorId}>{label}</label>
        {path ? (
          <OverflowTooltip
            className="instruction-editor__path"
            focusable={false}
            text={path}
          />
        ) : null}
        <InfoTip label={help} />
      </div>
      {agentStateUnavailable ? (
        <div className="instruction-editor__unavailable" role="status">
          {t("Current Agent instructions unavailable")}
        </div>
      ) : (
        <textarea
          id={editorId}
          aria-label={label}
          readOnly={policy !== "manage"}
          spellCheck={false}
          value={effectiveValue}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </div>
  );
};
