import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, GitBranch, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import type {
  WorkspaceSyncConflictChoice,
  WorkspaceSyncReview,
  WorkspaceSyncStatus
} from "../../shared/types";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";

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

export const WorkspaceSyncSettings = () => {
  const { t } = useI18n();
  const [status, setStatus] = useState(emptyStatus);
  const [repository, setRepository] = useState("");
  const [branch, setBranch] = useState("main");
  const [review, setReview] = useState<WorkspaceSyncReview>();
  const [choices, setChoices] = useState<Record<string, WorkspaceSyncConflictChoice>>({});
  const [acceptLive, setAcceptLive] = useState(false);
  const [working, setWorking] = useState<"connect" | "check" | "review" | "update" | "publish" | "recover" | "disconnect">();
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);

  const connected = Boolean(status.connection);
  const conflicts = review?.changes.filter((change) => change.direction === "conflict") ?? [];
  const choicesComplete = conflicts.every((change) => choices[change.key]);

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
    void window.agentEnv.readWorkspaceSyncStatus().then((next) => {
      if (!active) return;
      setStatus(next);
      if (next.connection) {
        setRepository(next.connection.repository);
        setBranch(next.connection.branch);
        void window.agentEnv.checkWorkspaceSync().then((checked) => active && setStatus(checked));
      }
    }).catch((unknownError) => active && setError(unknownError instanceof Error ? unknownError.message : String(unknownError)));
    return () => { active = false; };
  }, []);

  useModalDialog({
    open: Boolean(review),
    dialogRef,
    fallbackFocusRef: reviewButtonRef,
    onDismiss: () => setReview(undefined),
    dismissDisabled: working === "update" || working === "publish",
    focusKey: review?.remoteRevision ?? "workspace-sync-review"
  });

  const statusLabel = useMemo(() => {
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
  }, [status.kind, t]);
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
    if (next) setStatus(next);
  };
  const check = async () => {
    const next = await run("check", () => window.agentEnv.checkWorkspaceSync());
    if (next) setStatus(next);
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
            {status.kind === "up-to-date" ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}
            {statusLabel}
          </span>
        ) : null}
      </div>
      {!connected ? (
        <div className="workspace-sync-connect">
          <label>
            <span>{t("Private Git repository")}</span>
            <input value={repository} onChange={(event) => setRepository(event.currentTarget.value)} placeholder="git@github.com:you/agentenv-workspace.git" />
          </label>
          <label className="workspace-sync-branch">
            <span>{t("Branch")}</span>
            <input value={branch} onChange={(event) => setBranch(event.currentTarget.value)} />
          </label>
          <button className="primary-action" disabled={!repository.trim() || !branch.trim() || Boolean(working)} onClick={() => void connect()} type="button">
            {working === "connect" ? <LoaderCircle className="spin" size={15} /> : <GitBranch size={15} />}
            {t("Connect repository")}
          </button>
        </div>
      ) : (
        <>
          <div className="workspace-sync-connection">
            <GitBranch size={18} aria-hidden="true" />
            <span className="workspace-sync-repository" title={status.connection?.repository}>{compactRepository(status.connection?.repository)}</span>
            <code>{status.connection?.branch}</code>
            <span className="workspace-sync-summary">
              {status.localChangeCount ? t("{{count}} local", { count: status.localChangeCount }) : null}
              {status.remoteChangeCount ? t("{{count}} remote", { count: status.remoteChangeCount }) : null}
              {status.conflictCount ? t("{{count}} conflicts", { count: status.conflictCount }) : null}
            </span>
          </div>
          <div className="workspace-sync-actions">
            {status.kind === "recovery-required" ? (
              <button className="primary-action" disabled={Boolean(working)} onClick={() => void recover()} type="button">
                {working === "recover" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                {t("Recover Workspace")}
              </button>
            ) : null}
            {status.kind !== "recovery-required" ? <button className="secondary-action" disabled={Boolean(working)} onClick={() => void check()} type="button">
              <RefreshCw className={working === "check" ? "spin" : undefined} size={15} />
              {t("Check")}
            </button> : null}
            {status.kind !== "up-to-date" && status.kind !== "error" && status.kind !== "recovery-required" ? (
              <button ref={reviewButtonRef} className="primary-action" disabled={Boolean(working)} onClick={() => void openReview()} type="button">
                {working === "review" ? <LoaderCircle className="spin" size={15} /> : null}
                {t("Review changes")}
              </button>
            ) : null}
            <button className="text-action" disabled={Boolean(working)} onClick={() => void disconnect()} type="button">{t("Disconnect")}</button>
          </div>
        </>
      )}
      {error || status.message ? <div className="workspace-sync-error" role="alert">{error || status.message}</div> : null}

      {review ? (
        <div className="preview-modal-backdrop" onClick={() => !working && setReview(undefined)}>
          <section ref={dialogRef} className="profile-form-dialog workspace-sync-review" role="dialog" aria-modal="true" aria-label={t("Review Workspace changes")} onClick={(event) => event.stopPropagation()} tabIndex={-1}>
            <header className="profile-dialog-header">
              <div>
                <div className="section-title">{t("Review Workspace changes")}</div>
                <p className="muted">{t("Nothing is applied to an Agent by this step.")}</p>
              </div>
              <button className="icon-button" aria-label={t("Close")} disabled={Boolean(working)} onClick={() => setReview(undefined)} type="button"><X size={17} /></button>
            </header>
            <div className="workspace-sync-review-list">
              {review.changes.length ? review.changes.map((change) => (
                <div className="workspace-sync-change" key={change.key}>
                  <span className={`workspace-sync-change-kind is-${change.resourceKind}`}>{resourceLabel(change.resourceKind)}</span>
                  <span><strong>{change.title}</strong><small>{sectionLabel(change.section)} · {actionLabel(change.action)}</small></span>
                  <span className={`workspace-sync-direction is-${change.direction}`}>{directionLabel(change.direction)}</span>
                  {change.direction === "conflict" ? (
                    <select aria-label={t("Resolve {{name}}", { name: change.title })} value={choices[change.key] ?? ""} onChange={(event) => setChoices((current) => ({ ...current, [change.key]: event.currentTarget.value as WorkspaceSyncConflictChoice }))}>
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
            <footer className="preview-actions workspace-sync-review-actions">
              <button className="secondary-action" disabled={Boolean(working)} onClick={() => setReview(undefined)} type="button">{t("Cancel")}</button>
              {review.canPublish ? <button className="secondary-action" disabled={Boolean(working) || review.changes.some((change) => change.direction === "remote" || change.direction === "conflict")} onClick={() => void publish()} type="button">{working === "publish" ? <LoaderCircle className="spin" size={15} /> : null}{t("Publish")}</button> : null}
              {review.canUpdate ? <button className="primary-action" disabled={Boolean(working) || !choicesComplete || (review.liveSkillIds.length > 0 && !acceptLive)} onClick={() => void update()} type="button">{working === "update" ? <LoaderCircle className="spin" size={15} /> : null}{t("Update this Mac")}</button> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
};
