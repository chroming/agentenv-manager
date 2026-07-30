import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  GitBranch,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
  X
} from "lucide-react";
import type {
  WorkspaceSyncChange,
  WorkspaceSyncConflictChoice,
  WorkspaceSyncReview,
  WorkspaceSyncStatus
} from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { OverflowTooltip } from "./OverflowTooltip";
import { Button, IconButton, ModalFrame } from "./ui";

const emptyStatus: WorkspaceSyncStatus = {
  kind: "not-connected",
  localChangeCount: 0,
  remoteChangeCount: 0,
  conflictCount: 0,
  immediateAgentCount: 0
};

const compactRepository = (value: string | undefined) => {
  if (!value || value.length <= 46) return value;
  return `${value.slice(0, 20)}…${value.slice(-24)}`;
};

interface WorkspaceSyncReviewRow {
  key: string;
  changes: WorkspaceSyncChange[];
  resourceKind: WorkspaceSyncChange["resourceKind"];
  title: string;
  direction: WorkspaceSyncChange["direction"];
  action: WorkspaceSyncChange["action"];
}

export const groupWorkspaceSyncChanges = (changes: WorkspaceSyncChange[]): WorkspaceSyncReviewRow[] => {
  const rows = new Map<string, WorkspaceSyncReviewRow>();
  for (const change of changes) {
    const key = change.direction === "conflict"
      ? change.key
      : `${change.resourceKind}:${change.resourceId}:${change.direction}:${change.action}`;
    const row = rows.get(key);
    if (row) {
      row.changes.push(change);
    } else {
      rows.set(key, {
        key,
        changes: [change],
        resourceKind: change.resourceKind,
        title: change.title,
        direction: change.direction,
        action: change.action
      });
    }
  }
  return [...rows.values()];
};

export const WorkspaceSyncSettings = () => {
  const { t } = useI18n();
  const [status, setStatus] = useState(emptyStatus);
  const [loading, setLoading] = useState(true);
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [review, setReview] = useState<WorkspaceSyncReview>();
  const [choices, setChoices] = useState<Record<string, WorkspaceSyncConflictChoice>>({});
  const [acceptLive, setAcceptLive] = useState(false);
  const [working, setWorking] = useState<"connect" | "check" | "review" | "update" | "publish" | "recover" | "disconnect">();
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);

  const connected = Boolean(status.connection);
  const conflicts = review?.changes.filter((change) => change.direction === "conflict") ?? [];
  const choicesComplete = conflicts.every((change) => choices[change.key]);
  const reviewRows = useMemo(() => groupWorkspaceSyncChanges(review?.changes ?? []), [review]);

  const run = async <T,>(name: typeof working, operation: () => Promise<T>) => {
    setWorking(name);
    setError("");
    try {
      return await operation();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      return undefined;
    } finally {
      setWorking(undefined);
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const next = await window.agentEnv.readWorkspaceSyncStatus();
        if (!active) return;
        setStatus(next);
        setLoading(false);
        if (next.connection) {
          setRepository(next.connection.repository);
          setBranch(next.connection.branch);
          setStatus({ ...next, working: "checking" });
          try {
            const checked = await window.agentEnv.checkWorkspaceSync();
            if (active) setStatus(checked);
          } catch (unknownError) {
            if (!active) return;
            setStatus({
              ...next,
              kind: next.kind === "recovery-required" ? "recovery-required" : "error",
              message: undefined,
              working: undefined
            });
            setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
          }
        }
      } catch (unknownError) {
        if (active) {
          const message = unknownError instanceof Error ? unknownError.message : String(unknownError);
          setStatus({ ...emptyStatus, kind: "error", message });
          setLoading(false);
          setError(message);
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [loadAttempt]);

  useModalDialog({
    open: Boolean(review),
    dialogRef,
    fallbackFocusRef: reviewButtonRef,
    onDismiss: () => setReview(undefined),
    dismissDisabled: working === "update" || working === "publish",
    focusKey: review?.remoteRevision ?? "workspace-sync-review"
  });

  const statusLabel = useMemo(() => {
    if (status.working === "checking") return t("Checking");
    const labels: Record<WorkspaceSyncStatus["kind"], string> = {
      "not-connected": t("Not connected"),
      "up-to-date": t("Up to date"),
      "local-changes": t("Changes to publish"),
      "remote-changes": t("Changes to receive"),
      "review-required": t("Review required"),
      "error": t("Could not check"),
      "recovery-required": t("Recovery required")
    };
    return labels[status.kind];
  }, [status.kind, status.working, t]);
  const statusIcon = status.working === "checking"
    ? <LoaderCircle className="is-spinning" size={15} />
    : status.kind === "up-to-date"
      ? <CheckCircle2 size={15} />
      : status.kind === "local-changes"
        ? <ArrowUpFromLine size={15} />
        : status.kind === "remote-changes"
          ? <ArrowDownToLine size={15} />
          : <TriangleAlert size={15} />;
  const resourceLabel = (value: "profile" | "skill" | "source") => ({
    profile: t("Profile"),
    skill: t("Skill"),
    source: t("Source")
  })[value];
  const sectionLabel = (value: string) => ({
    manifest: t("Profile details"),
    instructions: t("Instructions"),
    resources: t("Resources"),
    content: t("Content"),
    metadata: t("Update settings"),
    sources: t("Sources")
  })[value] ?? value;
  const sectionSummary = (row: WorkspaceSyncReviewRow) => {
    const order: Record<string, number> = {
      manifest: 0,
      instructions: 1,
      resources: 2,
      content: 0,
      metadata: 1,
      sources: 0
    };
    return [...row.changes]
      .sort((left, right) => (order[left.section] ?? 99) - (order[right.section] ?? 99))
      .map((change) => sectionLabel(change.section))
      .join(", ");
  };
  const actionLabel = (value: string) => ({
    add: t("Add"),
    update: t("Update"),
    delete: t("Remove")
  })[value] ?? value;
  const directionLabel = (value: string) => ({
    local: t("This Mac"),
    remote: t("Remote"),
    both: t("Both"),
    conflict: t("Conflict")
  })[value] ?? value;

  const connect = async () => {
    const next = await run("connect", () => window.agentEnv.connectWorkspaceSync({ repository, branch }));
    if (next) {
      setStatus(next);
      setIsSetupOpen(false);
    }
  };
  const check = async () => {
    const next = await run("check", () => window.agentEnv.checkWorkspaceSync());
    if (next) {
      setStatus(next);
    } else {
      setStatus((current) => current.kind === "recovery-required"
        ? current
        : { ...current, kind: "error", message: undefined, working: undefined });
    }
  };
  const openReview = async () => {
    const next = await run("review", () => window.agentEnv.reviewWorkspaceSync());
    if (next) {
      setChoices({});
      setAcceptLive(false);
      setReview(next);
    }
  };
  const publish = async () => {
    const result = await run("publish", () => window.agentEnv.publishWorkspaceSync());
    if (result) {
      setStatus(result.status);
      setReview(undefined);
    }
  };
  const update = async () => {
    if (!review) return;
    const result = await run("update", () => window.agentEnv.updateWorkspaceFromSync({
      expectedRemoteRevision: review.remoteRevision,
      conflictChoices: choices,
      acceptLiveSkillUpdates: acceptLive
    }));
    if (result) {
      setStatus(result.status);
      setReview(undefined);
    }
  };
  const disconnect = async () => {
    const next = await run("disconnect", () => window.agentEnv.disconnectWorkspaceSync());
    if (next) {
      setStatus(next);
      setReview(undefined);
    }
  };
  const recover = async () => {
    const next = await run("recover", () => window.agentEnv.recoverWorkspaceSync());
    if (next) setStatus(next);
  };

  return (
    <section className="resource-section settings-section workspace-sync-settings" aria-labelledby="workspace-sync-heading">
      <div className="settings-section-header">
        <div>
          <div className="resource-heading" id="workspace-sync-heading">{t("Workspace Sync")}</div>
          <p className="settings-muted">{t("Reuse Profiles and Library Skills across your Macs through a private Git repository.")}</p>
        </div>
        {connected ? (
          <span className={`workspace-sync-status is-${status.kind}`} role="status">
            {statusIcon}
            {statusLabel}
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="inline-state inline-state--loading workspace-sync-loading" role="status">
          <span className="inline-state__icon" aria-hidden="true" />
          <span>{t("Loading")}</span>
        </div>
      ) : !connected && status.kind === "error" ? (
        <div className="workspace-sync-disconnected is-error" role="alert">
          <span className="settings-service-icon" aria-hidden="true">
            <TriangleAlert size={19} />
          </span>
          <span>
            <strong>{t("Could not check")}</strong>
            <small>{error || status.message}</small>
          </span>
          <Button
            variant="secondary"
            icon={<RefreshCw />}
            onClick={() => setLoadAttempt((current) => current + 1)}
          >
            {t("Retry")}
          </Button>
        </div>
      ) : !connected ? (
        <>
          <div className="workspace-sync-disconnected">
            <span className="settings-service-icon" aria-hidden="true">
              <GitBranch size={19} />
            </span>
            <span>
              <strong>{t("Not configured")}</strong>
              <small>{t("Connect a private Git repository when you want to reuse this Workspace on another Mac.")}</small>
            </span>
            <Button variant="secondary" onClick={() => setIsSetupOpen((current) => !current)}>
              {t(isSetupOpen ? "Cancel" : "Set up")}
            </Button>
          </div>
          {isSetupOpen ? (
            <div className="workspace-sync-connect">
              <label>
                <span>{t("Private Git repository")}</span>
                <input value={repository} onChange={(event) => setRepository(event.currentTarget.value)} placeholder="git@github.com:you/agentenv-workspace.git" />
              </label>
              <label className="workspace-sync-branch">
                <span>{t("Branch")}</span>
                <input value={branch} onChange={(event) => setBranch(event.currentTarget.value)} />
              </label>
              <Button variant="primary" busy={working === "connect"} icon={<GitBranch />} disabled={!repository.trim() || !branch.trim() || Boolean(working)} onClick={() => void connect()}>
                {t("Connect repository")}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="workspace-sync-connection">
            <GitBranch size={18} aria-hidden="true" />
            <OverflowTooltip
              className="workspace-sync-repository"
              displayText={compactRepository(status.connection?.repository)}
              text={status.connection?.repository ?? ""}
            />
            <span className="workspace-sync-branch-name">{status.connection?.branch}</span>
            <span className="workspace-sync-summary">
              {status.localChangeCount ? t("{{count}} local", { count: status.localChangeCount }) : null}
              {status.remoteChangeCount ? t("{{count}} remote", { count: status.remoteChangeCount }) : null}
              {status.conflictCount ? t("{{count}} conflicts", { count: status.conflictCount }) : null}
            </span>
          </div>
          <div className="workspace-sync-actions">
            {status.kind === "recovery-required" ? (
              <Button variant="primary" busy={working === "recover"} icon={<RefreshCw />} disabled={Boolean(working)} onClick={() => void recover()}>
                {t("Recover Workspace")}
              </Button>
            ) : null}
            {status.kind !== "recovery-required" ? <Button variant="secondary" busy={working === "check"} icon={<RefreshCw />} disabled={Boolean(working)} onClick={() => void check()}>
              {t("Check")}
            </Button> : null}
            {status.kind !== "up-to-date" && status.kind !== "error" && status.kind !== "recovery-required" ? (
              <Button ref={reviewButtonRef} variant="primary" busy={working === "review"} disabled={Boolean(working)} onClick={() => void openReview()}>
                {t("Review changes")}
              </Button>
            ) : null}
            {status.kind !== "recovery-required" ? (
              <Button variant="ghost" disabled={Boolean(working)} onClick={() => void disconnect()}>{t("Disconnect")}</Button>
            ) : null}
          </div>
        </>
      )}
      {connected && (error || status.message) ? (
        <div className="workspace-sync-error" role="alert">{error || status.message}</div>
      ) : null}

      {review ? (
        <ModalFrame
          ariaLabel={t("Review Workspace changes")}
          className="workspace-sync-review ui-dialog-shell"
          dialogRef={dialogRef}
          dismissPolicy="intentional"
          dismissDisabled={Boolean(working)}
          onDismiss={() => setReview(undefined)}
        >
            <header className="profile-dialog-header ui-dialog-header">
              <div className="ui-dialog-header__copy">
                <div className="workspace-sync-review-title ui-dialog-title">{t("Review Workspace changes")}</div>
                <p className="muted ui-dialog-description">{t("Nothing is applied to an Agent by this step.")}</p>
              </div>
              <IconButton variant="ghost" label={t("Close")} disabled={Boolean(working)} onClick={() => setReview(undefined)}><X /></IconButton>
            </header>
            <div className="workspace-sync-review-body ui-dialog-body">
              <div className="workspace-sync-review-list">
                {reviewRows.length ? reviewRows.map((row) => (
                  <div className={`workspace-sync-change${row.direction === "conflict" ? " has-resolution" : ""}`} key={row.key}>
                    <span className={`workspace-sync-change-kind is-${row.resourceKind}`}>{resourceLabel(row.resourceKind)}</span>
                    <span className="workspace-sync-change-identity">
                      <OverflowTooltip className="workspace-sync-change-title" text={row.title} />
                      <small>{sectionSummary(row)} · {actionLabel(row.action)}</small>
                    </span>
                    <span className={`workspace-sync-direction is-${row.direction}`}>{directionLabel(row.direction)}</span>
                    {row.direction === "conflict" ? (
                      <select aria-label={t("Resolve {{name}}", { name: row.title })} value={choices[row.changes[0]!.key] ?? ""} onChange={(event) => setChoices((current) => ({ ...current, [row.changes[0]!.key]: event.currentTarget.value as WorkspaceSyncConflictChoice }))}>
                        <option value="">{t("Choose version")}</option>
                        <option value="local">{t("Keep this Mac")}</option>
                        <option value="remote">{t("Use remote")}</option>
                      </select>
                    ) : null}
                  </div>
                )) : <div className="workspace-sync-empty">{t("Workspace is up to date.")}</div>}
              </div>
              {review.liveSkillIds.length ? (
                <label className="workspace-sync-live-warning">
                  <input type="checkbox" checked={acceptLive} onChange={(event) => setAcceptLive(event.currentTarget.checked)} />
                  <span><strong>{t("Linked Skills change immediately")}</strong><small>{t("{{skills}} linked Skills may immediately affect {{agents}} Agents.", { skills: review.liveSkillIds.length, agents: review.liveAgentIds.length })}</small></span>
                </label>
              ) : null}
              {error ? <div className="workspace-sync-error" role="alert">{error}</div> : null}
            </div>
            <footer className="preview-actions workspace-sync-review-actions ui-dialog-footer">
              <Button variant="secondary" disabled={Boolean(working)} onClick={() => setReview(undefined)}>{t("Cancel")}</Button>
              {review.canPublish && !review.canUpdate ? <Button variant="primary" busy={working === "publish"} disabled={Boolean(working)} onClick={() => void publish()}>{t("Publish")}</Button> : null}
              {review.canUpdate ? <Button variant="primary" busy={working === "update"} disabled={Boolean(working) || !choicesComplete || (review.liveSkillIds.length > 0 && !acceptLive)} onClick={() => void update()}>{t("Update this Mac")}</Button> : null}
            </footer>
        </ModalFrame>
      ) : null}
    </section>
  );
};
