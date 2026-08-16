import type { RefObject } from "react";
import { CheckCircle2, Circle, CircleSlash2, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { SkillCleanupRequest } from "../../shared/types";
import type {
  SkillCleanupAutomaticEffect,
  SkillCleanupGroup
} from "../../shared/skillCleanup";
import { useI18n } from "../i18n";
import { cleanupEffectLabel } from "../skillCleanupPresentation";
import { targetNameFor, type TargetNameIndex } from "../targetPresentation";
import { OverflowTooltip as PreviewText } from "./OverflowTooltip";
import { Button, type ButtonVariant } from "./ui";

export type AutomaticCleanupStatus =
  | "waiting"
  | "managing"
  | "managed"
  | "failed"
  | "skipped";

export interface AutomaticCleanupProgress {
  status: AutomaticCleanupStatus;
  error?: string;
}

export interface AutomaticCleanupReviewItem {
  effect: SkillCleanupAutomaticEffect;
  request?: SkillCleanupRequest;
  skillKey: string;
  name: string;
  paths: string[];
  secondary?: string;
}

export const buildAutomaticCleanupReviewItems = (
  requests: SkillCleanupRequest[],
  cleanupGroups: SkillCleanupGroup[],
  sharedCandidates: SkillCleanupGroup[],
  targetNames: TargetNameIndex
) => {
  const groupsByKey = new Map(cleanupGroups.map((group) => [group.skillKey, group]));
  const items: AutomaticCleanupReviewItem[] = requests.flatMap((request) => {
    const group = groupsByKey.get(request.skillKey);
    if (!group?.automaticEffect) return [];
    return [{
      effect: group.automaticEffect,
      request,
      skillKey: request.skillKey,
      name: group.primary?.name ?? group.skillKey,
      paths: [
        ...(request.sharedLocations ?? []).map((location) => location.path),
        ...request.locations.map((location) => location.path)
      ],
      secondary: group.sharedMigration
        ? group.sharedMigration.consumers
            .map((targetId) => targetNameFor(targetId, targetNames, targetId))
            .join(", ")
        : undefined
    }];
  });
  const known = new Set(items.map((item) => item.skillKey));
  for (const group of sharedCandidates) {
    if (known.has(group.skillKey)) continue;
    const migration = group.sharedMigration;
    items.push({
      effect: "move-shared-to-agents",
      request: undefined,
      skillKey: group.skillKey,
      name: group.primary?.name ?? group.skillKey,
      paths: migration?.paths ?? [],
      secondary: migration
        ? migration.consumers
            .map((targetId) => targetNameFor(targetId, targetNames, targetId))
            .join(", ")
        : undefined
    });
  }
  return items;
};

interface AutomaticSkillCleanupDialogProps {
  items: AutomaticCleanupReviewItem[];
  progress: Record<string, AutomaticCleanupProgress>;
  running: boolean;
  stopRequested: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  onRun(requests: SkillCleanupRequest[]): void;
  onStop(): void;
  title?: string;
  description?: string;
  runLabel?: string;
  runVariant?: ButtonVariant;
  safetyNote?: string;
}

export const AutomaticSkillCleanupDialog = ({
  items,
  progress,
  running,
  stopRequested,
  dialogRef,
  initialFocusRef,
  onClose,
  onRun,
  onStop,
  title = "Manage eligible local Skills",
  description = "AgentEnv will manage the eligible items below. Every changed path is backed up before the operation starts.",
  runLabel,
  runVariant = "primary",
  safetyNote
}: AutomaticSkillCleanupDialogProps) => {
  const { t } = useI18n();
  const groups = new Map<SkillCleanupAutomaticEffect, AutomaticCleanupReviewItem[]>();
  for (const item of items) {
    groups.set(item.effect, [...(groups.get(item.effect) ?? []), item]);
  }
  const runStarted = Object.keys(progress).length > 0;
  const statusFor = (skillKey: string) => {
    const itemProgress = progress[skillKey];
    if (!itemProgress) return null;
    const icon = itemProgress.status === "managing"
      ? <LoaderCircle className="is-spinning" size={13} strokeWidth={2.2} />
      : itemProgress.status === "managed"
        ? <CheckCircle2 size={13} strokeWidth={2.2} />
        : itemProgress.status === "failed"
          ? <TriangleAlert size={13} strokeWidth={2.2} />
          : itemProgress.status === "skipped"
            ? <CircleSlash2 size={13} strokeWidth={2.2} />
            : <Circle size={13} strokeWidth={2.2} />;
    const label = itemProgress.status === "managing"
      ? t("Managing...")
      : itemProgress.status === "managed"
        ? t("Managed")
        : itemProgress.status === "failed"
          ? t("Needs review")
          : itemProgress.status === "skipped"
            ? t("Skipped")
            : t("Waiting");
    return (
      <span
        className={`cleanup-bulk-item__status is-${itemProgress.status}`}
        title={itemProgress.error || label}
      >
        {icon}
        <span>{label}</span>
      </span>
    );
  };

  return createPortal(
    <div className="preview-modal-backdrop" data-dismiss-policy="standard" onClick={onClose}>
      <section
        ref={dialogRef}
        className="profile-form-dialog profile-form-dialog--compact cleanup-bulk-dialog ui-dialog-shell"
        role="dialog"
        aria-label={t(title)}
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="profile-dialog-header ui-dialog-header">
          <div className="ui-dialog-header__copy">
            <div className="section-title ui-dialog-title">{t(title)}</div>
            <p className="muted ui-dialog-description">
              {t(description)}
            </p>
          </div>
        </header>
        <div className="cleanup-bulk-review-list ui-dialog-body">
          {[...groups.entries()].map(([effect, groupItems]) => (
            <section className="cleanup-bulk-effect" key={effect}>
              <div className="cleanup-bulk-effect__header">
                <strong>{t(cleanupEffectLabel(effect))}</strong>
                <span>{groupItems.length}</span>
              </div>
              <div className="cleanup-bulk-items">
                {groupItems.map((item) => (
                  <div className="cleanup-bulk-item" key={item.skillKey}>
                    <div className="cleanup-bulk-item__heading">
                      <strong>{item.name}</strong>
                      {statusFor(item.skillKey)}
                    </div>
                    {item.secondary ? <small>{t(item.secondary)}</small> : null}
                    <PreviewText
                      ariaLabel={t("Full cleanup paths for {{id}}", { id: item.skillKey })}
                      className="cleanup-bulk-item__path"
                      displayText={item.paths.length > 1
                        ? t("{{path}} and {{count}} more", {
                            path: item.paths[0],
                            count: item.paths.length - 1
                          })
                        : item.paths[0]}
                      text={item.paths.join("\n")}
                      tooltipClassName="library-source-tooltip"
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
          {safetyNote ? (
            <div className="cleanup-bulk-safety-note" role="note">
              <TriangleAlert size={15} strokeWidth={2.1} aria-hidden="true" />
              <span>{t(safetyNote)}</span>
            </div>
          ) : null}
          <small>{t("Each Skill is backed up independently. A failure does not undo completed Skills.")}</small>
        </div>
        <footer className="preview-actions ui-dialog-footer">
          <Button ref={initialFocusRef} disabled={running} onClick={onClose}>
            {t(runStarted ? "Close" : "Cancel")}
          </Button>
          {running ? (
            <Button
              disabled={stopRequested}
              icon={<X size={14} strokeWidth={2.2} />}
              variant="secondary"
              onClick={onStop}
            >
              {t(stopRequested ? "Stopping..." : "Stop after current")}
            </Button>
          ) : !runStarted ? (
            <Button
              variant={runVariant}
              onClick={() => onRun(items.flatMap((item) => item.request ? [item.request] : []))}
            >
              {runLabel ? t(runLabel) : t("Manage {{count}} skills", { count: items.length })}
            </Button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body
  );
};
