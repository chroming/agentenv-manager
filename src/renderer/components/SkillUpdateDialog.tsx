import { useRef } from "react";
import type { SkillUpdatePlan } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { DiffViewer } from "./DiffViewer";
import { Button, ModalFrame } from "./ui";

interface SkillUpdateDialogProps {
  plan?: SkillUpdatePlan;
  impact?: string;
  busy?: boolean;
  onClose(): void;
  onConfirm(id: string): void;
}

export const SkillUpdateDialog = ({
  plan,
  impact,
  busy = false,
  onClose,
  onConfirm
}: SkillUpdateDialogProps) => {
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);

  useModalDialog({
    open: Boolean(plan),
    dialogRef,
    initialFocusRef,
    onDismiss: onClose,
    dismissDisabled: busy,
    focusKey: plan?.id
  });

  if (!plan || plan.changes.length === 0) {
    return null;
  }

  return (
    <ModalFrame
      ariaLabel={`Update preview for ${plan.id}`}
      className="skill-update-dialog"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onClose}
    >
        <header className="profile-dialog-header">
          <div>
            <div className="section-title">Update {plan.name}</div>
            <p className="muted">
              {plan.changes.length} file {plan.changes.length === 1 ? "change" : "changes"}
              {plan.latestRevision
                ? ` · ${(plan.currentRevision ?? "current").slice(0, 7)} → ${plan.latestRevision.slice(0, 7)}`
                : ""}
            </p>
            {impact ? <p className="skill-update-impact">{impact}</p> : null}
          </div>
        </header>
        <div className="update-change-list">
          {plan.changes.map((change) => (
            <details key={change.path} open>
              <summary>{change.path}</summary>
              <DiffViewer path={change.path} diff={change.diff} />
            </details>
          ))}
        </div>
        <footer className="preview-actions">
          <Button
            ref={initialFocusRef}
            disabled={busy}
            size="prominent"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            aria-label={`Apply update ${plan.id}`}
            disabled={busy}
            size="prominent"
            variant="primary"
            onClick={() => onConfirm(plan.id)}
          >
            {busy ? "Updating..." : "Update skill"}
          </Button>
        </footer>
    </ModalFrame>
  );
};
