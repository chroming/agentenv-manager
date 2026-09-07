import { CheckCircle2, CircleArrowUp, CircleSlash2, EyeOff, Link2Off, Plus, SearchCheck, TriangleAlert } from "lucide-react";
import type { MouseEvent } from "react";
import type { SkillMaintenanceState } from "../skillMaintenanceState";
import { useI18n } from "../i18n";
import { InteractiveStatus, type SemanticStatusKind } from "./ui";

const presentation = {
  disabled: { label: "Disabled", kind: "neutral", icon: CircleSlash2 },
  untracked: { label: "No update checks", kind: "neutral", icon: Link2Off },
  unchecked: { label: "Not checked", kind: "neutral", icon: SearchCheck },
  current: { label: "Up to date", kind: "neutral", icon: CheckCircle2 },
  update: { label: "Update available", kind: "update-available", icon: CircleArrowUp },
  removed: { label: "Removed upstream", kind: "warning", icon: Link2Off },
  error: { label: "Check failed", kind: "error", icon: TriangleAlert },
  new: { label: "New", kind: "working", icon: Plus },
  ignored: { label: "Ignored", kind: "neutral", icon: EyeOff },
  invalid: { label: "Invalid upstream", kind: "warning", icon: TriangleAlert },
  conflict: { label: "Relationship conflict", kind: "warning", icon: TriangleAlert },
  missing: { label: "Library copy missing", kind: "warning", icon: Link2Off }
} satisfies Record<SkillMaintenanceState, { label: string; kind: SemanticStatusKind; icon: typeof CheckCircle2 }>;

export const SkillMaintenanceStatus = ({ state, busy, disabled, detail, onReview, reviewLabel, className }: {
  state: SkillMaintenanceState;
  busy?: boolean;
  disabled?: boolean;
  detail?: string;
  onReview?(event: MouseEvent<HTMLButtonElement>): void;
  reviewLabel?: string;
  className?: string;
}) => {
  const { t } = useI18n();
  const item = presentation[state];
  const Icon = item.icon;
  return <InteractiveStatus size="metadata" className={className}
    statusKind={item.kind} icon={<Icon />} label={t(item.label)}
    busy={busy} disabled={disabled} title={detail}
    onReview={onReview} reviewLabel={reviewLabel} />;
};
