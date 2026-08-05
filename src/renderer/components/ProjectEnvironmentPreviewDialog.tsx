import { AlertTriangle, Maximize2, Minimize2 } from "lucide-react";
import { useRef, useState } from "react";
import type { ProjectEnvironmentPreview } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { Button, IconButton, ModalFrame } from "./ui";

interface ProjectEnvironmentPreviewDialogProps {
  open: boolean;
  busy: boolean;
  preview?: ProjectEnvironmentPreview;
  error?: string;
  onClose(): void;
}

const kindLabel = (kind: "instructions" | "skill" | "mcp") =>
  kind === "instructions" ? "Instructions" : kind === "skill" ? "Skill" : "MCP";

export const ProjectEnvironmentPreviewDialog = ({
  open,
  busy,
  preview,
  error,
  onClose
}: ProjectEnvironmentPreviewDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [maximized, setMaximized] = useState(false);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: closeRef,
    onDismiss: onClose,
    dismissDisabled: busy
  });

  if (!open) return null;
  const fidelityLabel = preview?.fidelity === "partial" ? t("Partial") : t("Complete");
  return (
    <ModalFrame
      ariaLabel={t("Effective environment preview")}
      className={`project-environment-dialog ui-dialog-shell${maximized ? " is-maximized" : ""}`}
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onClose}
    >
      <header className="ui-dialog-header project-environment-dialog__header">
        <div className="ui-dialog-header__copy">
          <div className="ui-dialog-title">{t("Effective environment preview")}</div>
          <p className="ui-dialog-description">
            {preview ? `${preview.agentName} · ${fidelityLabel}` : t("Reading the current Agent environment…")}
          </p>
        </div>
        <IconButton
          label={t(maximized ? "Restore preview" : "Maximize preview")}
          onClick={() => setMaximized((value) => !value)}
        >
          {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </IconButton>
      </header>
      <div className="ui-dialog-body project-environment-dialog__body">
        {busy ? <div className="project-preview-loading">{t("Reading the current Agent environment…")}</div> : null}
        {error ? <div className="project-preview-error" role="alert">{error}</div> : null}
        {preview ? (
          <>
            <div className="project-preview-scope-note">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{t("Load order unknown. Project and Agent-global sources remain separate.")}</span>
            </div>
            <div className="project-preview-columns">
              <section aria-label={t("Project resources")}>
                <header>
                  <strong>{t("Project resources")}</strong>
                  <span>{preview.projectResources.length}</span>
                </header>
                <div className="project-preview-resource-list">
                  {preview.projectResources.length === 0 ? (
                    <p>{t("No project resources found for this Agent.")}</p>
                  ) : preview.projectResources.map((resource) => (
                    <div className="project-preview-resource" key={resource.id}>
                      <span>{t(kindLabel(resource.kind))}</span>
                      <strong>{resource.name}</strong>
                      <code className="selectable" title={resource.absolutePath}>{resource.relativePath}</code>
                    </div>
                  ))}
                </div>
              </section>
              <section aria-label={t("Agent-global resources")}>
                <header>
                  <strong>{t("Agent-global resources")}</strong>
                  <span>{preview.globalResources.length}</span>
                </header>
                <div className="project-preview-resource-list">
                  {preview.globalResources.length === 0 ? (
                    <p>{t("No observable global resources found.")}</p>
                  ) : preview.globalResources.map((resource, index) => (
                    <div className="project-preview-resource" key={`${resource.kind}:${resource.path}:${resource.name}:${index}`}>
                      <span>{t(kindLabel(resource.kind))}</span>
                      <strong>{resource.name}</strong>
                      <code className="selectable" title={resource.path}>{resource.path}</code>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            {preview.issues.length > 0 ? (
              <details className="project-preview-issues">
                <summary>{t("{{count}} sources need attention", { count: preview.issues.length })}</summary>
                <ul>{preview.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
      <footer className="ui-dialog-footer">
        <Button ref={closeRef} disabled={busy} onClick={onClose}>{t("Close")}</Button>
      </footer>
    </ModalFrame>
  );
};
