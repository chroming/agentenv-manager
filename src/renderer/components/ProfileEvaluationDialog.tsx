import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Expand,
  FileDiff,
  FlaskConical,
  FolderOpen,
  LoaderCircle,
  RotateCcw,
  Square,
  X,
  XCircle
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from "react";
import type {
  OneShotEvaluationPreview,
  OneShotEvaluationRun,
  PlannedFileChange,
  ProfileDetail,
  TargetInfo
} from "../../shared/types";
import {
  oneShotEvaluationIsActive,
  type OneShotEvaluationResourceScope
} from "../../shared/evaluations";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { DiffViewer } from "./DiffViewer";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";
import { ConversationMarkdown } from "./ConversationMarkdown";
import { Button, IconButton, ModalFrame } from "./ui";

interface ProfileEvaluationDialogProps {
  open: boolean;
  profile: ProfileDetail;
  targets: TargetInfo[];
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
}

type ResultTab = "response" | "changes" | "details";

const modeLabel = (mode: string) =>
  mode === "manage" ? "Use Profile" : mode === "disable" ? "Turn off" : "Keep current";

const statusLabel = (status: OneShotEvaluationRun["status"]) => ({
  preparing: "Preparing",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Completed",
  "failed-to-run": "Failed to run",
  cancelled: "Cancelled"
})[status];

const resultTabLabel = (tab: ResultTab) => ({
  response: "Response",
  changes: "Changes",
  details: "Run details"
})[tab];

const formatDuration = (milliseconds: number) => {
  if (milliseconds > 0 && milliseconds < 1_000) return "<1s";
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
};

const resultChanges = (run: OneShotEvaluationRun | undefined): PlannedFileChange[] =>
  (run?.result?.fileDiffs ?? []).map((change) => ({
    path: change.path,
    before: "",
    after: "",
    diff: change.diff,
    action: change.action === "remove" ? "remove" : "write"
  }));

export const ProfileEvaluationDialog = ({
  open,
  profile,
  targets,
  returnFocusRef,
  onClose
}: ProfileEvaluationDialogProps) => {
  const { formatDate, formatNumber, t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const [targetId, setTargetId] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<OneShotEvaluationPreview>();
  const [previewing, setPreviewing] = useState(false);
  const [reviewingSource, setReviewingSource] = useState<"project" | "environment">("project");
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<OneShotEvaluationRun>();
  const [restoredRun, setRestoredRun] = useState(false);
  const [responseCopied, setResponseCopied] = useState(false);
  const [error, setError] = useState("");
  const [resultTab, setResultTab] = useState<ResultTab>("response");
  const [selectedDiffPath, setSelectedDiffPath] = useState("");
  const [diffWorkspaceOpen, setDiffWorkspaceOpen] = useState(false);
  const supportedTargets = useMemo(
    () => targets.filter((target) => target.capabilities.evaluation && target.health.executablePath),
    [targets]
  );
  const active = Boolean(run && oneShotEvaluationIsActive(run.status));
  const locked = active || starting;
  const changes = useMemo(() => resultChanges(run), [run]);
  const selectedChange = changes.find((change) => change.path === selectedDiffPath) ?? changes[0];
  const openSessionKey = open ? profile.id : "";

  const dismiss = () => {
    if (!locked) onClose();
  };

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef,
    fallbackFocusRef: returnFocusRef,
    onDismiss: dismiss,
    dismissDisabled: locked || diffWorkspaceOpen,
    focusKey: `${profile.id}:${run?.runId ?? "setup"}`
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const preferred = supportedTargets.find(
      (target) => target.id === profile.manifest.preferredTargetId
    ) ?? supportedTargets[0];
    setTargetId(preferred?.id ?? "");
    setProjectPath("");
    setPrompt("");
    setPreview(undefined);
    setPreviewing(false);
    setReviewingSource("project");
    setStarting(false);
    setRun(undefined);
    setRestoredRun(false);
    setResponseCopied(false);
    setError("");
    setResultTab("response");
    setSelectedDiffPath("");
    setDiffWorkspaceOpen(false);

    void window.agentEnv.readEvaluation().then((current) => {
      if (cancelled || !current || current.profileId !== profile.id) return;
      setRun(current);
      setRestoredRun(true);
      setProjectPath(current.projectPath);
      if (current.result) {
        setPrompt(current.result.prompt);
        setSelectedDiffPath(current.result.fileDiffs[0]?.path ?? "");
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [openSessionKey]);

  useEffect(() => {
    if (!responseCopied) return undefined;
    const timer = window.setTimeout(() => setResponseCopied(false), 2_000);
    return () => window.clearTimeout(timer);
  }, [responseCopied]);

  useEffect(() => {
    if (!run || !oneShotEvaluationIsActive(run.status)) return undefined;
    const timer = window.setInterval(() => {
      void window.agentEnv.readEvaluation({ runId: run.runId }).then((next) => {
        if (!next) return;
        setRun(next);
        if (next.result?.fileDiffs[0]?.path) {
          setSelectedDiffPath((current) => current || next.result!.fileDiffs[0]!.path);
        }
      }).catch((unknownError) => {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    }, 350);
    return () => window.clearInterval(timer);
  }, [run?.runId, run?.status]);

  const reviewProject = async (
    path: string,
    nextTargetId = targetId,
    source: "project" | "environment" = "environment"
  ) => {
    if (!path || !nextTargetId) return;
    setReviewingSource(source);
    setPreviewing(true);
    setError("");
    try {
      const next = await window.agentEnv.previewEvaluation({
        profileId: profile.id,
        targetId: nextTargetId,
        projectPath: path,
        excludeMcp: true
      });
      setPreview(next);
    } catch (unknownError) {
      setPreview(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setPreviewing(false);
    }
  };

  const chooseProject = async () => {
    setError("");
    try {
      const selected = await window.agentEnv.selectEvaluationProject();
      if (!selected) return;
      setProjectPath(selected);
      await reviewProject(selected, targetId, "project");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const updateTarget = (nextTargetId: string) => {
    setTargetId(nextTargetId);
    setPreview(undefined);
    setError("");
    if (projectPath) void reviewProject(projectPath, nextTargetId, "environment");
  };

  const start = async () => {
    if (!preview) return;
    setError("");
    setStarting(true);
    try {
      const next = await window.agentEnv.startEvaluation({
        previewId: preview.previewId,
        prompt
      });
      setRestoredRun(false);
      setRun(next);
    } catch (unknownError) {
      setPreview(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    setError("");
    try {
      setRun(await window.agentEnv.cancelEvaluation(run.runId));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const runAgain = () => {
    setRun(undefined);
    setResultTab("response");
    setSelectedDiffPath("");
    setError("");
    if (projectPath) void reviewProject(projectPath);
  };

  if (!open) return null;

  const result = run?.result;
  const terminal = Boolean(run && !oneShotEvaluationIsActive(run.status));
  const dialogTitle = terminal
    ? run?.status === "completed"
      ? restoredRun ? "Latest evaluation" : "Evaluation completed"
      : statusLabel(run!.status)
    : "";
  const cancelLabel = run?.status === "cancelling" ? "Cancelling" : "Cancel evaluation";
  const projectName = (result?.projectPath ?? run?.projectPath ?? projectPath)
    .split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  const changedFilesLabel = result?.changedFiles.length === 1
    ? "1 file changed"
    : "{{count}} files changed";
  const tokenSummary = result?.usage?.totalTokens !== undefined
    ? t("{{count}} tokens", { count: formatNumber(result.usage.totalTokens) })
    : result?.usage?.inputTokens !== undefined || result?.usage?.outputTokens !== undefined
      ? t("{{input}} in · {{output}} out", {
          input: result.usage.inputTokens === undefined
            ? t("Unavailable")
            : formatNumber(result.usage.inputTokens),
          output: result.usage.outputTokens === undefined
            ? t("Unavailable")
            : formatNumber(result.usage.outputTokens)
        })
      : t("Tokens unavailable");
  const scopeSummary = (scope: OneShotEvaluationResourceScope) =>
    scope.mode === "disable"
      ? t("Turn off")
      : t("{{mode}} · {{count}}", {
          mode: t(modeLabel(scope.mode)),
          count: scope.includedCount
        });

  return (
    <>
      <ModalFrame
        ariaLabel={t("Evaluate {{name}}", { name: profile.manifest.name })}
        className="profile-evaluation-dialog ui-dialog-shell"
        dialogRef={dialogRef}
        dismissDisabled={locked}
        onDismiss={dismiss}
        suspended={diffWorkspaceOpen}
      >
        <header className="ui-dialog-header profile-evaluation-dialog__header">
          <div className="profile-evaluation-dialog__heading-icon" aria-hidden="true">
            {run?.status === "completed" ? (
              <CheckCircle2 size={19} />
            ) : run?.status === "failed-to-run" ? (
              <XCircle size={19} />
            ) : (
              <FlaskConical size={19} />
            )}
          </div>
          <div className="ui-dialog-header__copy">
            <h2 className="ui-dialog-title">
              {terminal
                ? t(dialogTitle)
                : t("Evaluate {{name}}", { name: profile.manifest.name })}
            </h2>
            <p className="ui-dialog-description">
              {terminal
                ? t("Review the response, workspace changes, and reported usage.")
                : active
                  ? t("The Agent is running only inside a temporary project and Home.")
                  : t("Uses the Agent account and model quota. External tools, MCPs, and project Agent files are excluded; the real Agent and project stay unchanged.")}
            </p>
          </div>
          {!locked ? (
            <IconButton label={t("Close")} onClick={onClose}>
              <X size={17} />
            </IconButton>
          ) : null}
        </header>

        <div className="ui-dialog-body profile-evaluation-dialog__body">
          {!run ? (
            <div className="profile-evaluation-setup">
              <div className="profile-evaluation-fields">
                <label className="profile-evaluation-field">
                  <span className="profile-evaluation-field__label">{t("Agent")}</span>
                  {supportedTargets.length <= 1 ? (
                    <span className="profile-evaluation-static-value">
                      {supportedTargets[0]?.name ?? t("No supported Agent available")}
                    </span>
                  ) : (
                    <select
                      value={targetId}
                      disabled={previewing || starting}
                      onChange={(event) => updateTarget(event.target.value)}
                    >
                      {supportedTargets.map((target) => (
                        <option key={target.id} value={target.id}>{target.name}</option>
                      ))}
                    </select>
                  )}
                </label>
                <div className="profile-evaluation-field">
                  <span className="profile-evaluation-field__label">{t("Project")}</span>
                  <Button
                    ref={initialFocusRef}
                    className="profile-evaluation-project-button"
                    busy={previewing && reviewingSource === "project"}
                    disabled={!targetId || starting}
                    icon={<FolderOpen size={15} />}
                    onClick={() => void chooseProject()}
                  >
                    {projectPath ? t("Change project") : t("Choose Git project")}
                  </Button>
                  {preview ? (
                    <div className="profile-evaluation-project-meta">
                      <code title={preview.projectPath}>{preview.projectPath}</code>
                      <span>{t("Revision {{revision}}", { revision: preview.projectRevision.slice(0, 7) })}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <label className="profile-evaluation-field profile-evaluation-task">
                <span className="profile-evaluation-field__label">{t("Task")}</span>
                <textarea
                  rows={4}
                  value={prompt}
                  disabled={starting}
                  placeholder={t("Describe the one task this Agent should perform…")}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>

              {preview ? (
                <section className="profile-evaluation-environment" aria-label={t("Profile environment")}>
                  <header>
                    <div>
                      <strong>{t("Profile environment")}</strong>
                      <small>{preview.targetName} · {preview.cliVersion ?? t("Version unavailable")}</small>
                    </div>
                    <span className="profile-evaluation-fidelity is-partial">
                      {t("Restricted Profile")}
                    </span>
                  </header>
                  <div className="profile-evaluation-resource-grid">
                    <span>
                      <small>{t("Instructions")}</small>
                      <strong>{scopeSummary(preview.resources.instructions)}</strong>
                    </span>
                    <span>
                      <small>{t("Skills")}</small>
                      <strong>{scopeSummary(preview.resources.skills)}</strong>
                    </span>
                    <span>
                      <small>{t("MCP")}</small>
                      <strong>{preview.resources.mcp.mode === "disable"
                        ? t("Turn off")
                        : t("Excluded for safe evaluation · {{count}}", {
                            count: preview.resources.mcp.omittedCount ?? 0
                          })}</strong>
                    </span>
                  </div>
                </section>
              ) : null}

              {previewing && reviewingSource === "environment" ? (
                <div className="profile-evaluation-reviewing" role="status">
                  <LoaderCircle className="is-spinning" size={15} />
                  <span>{t("Reviewing Profile environment…")}</span>
                </div>
              ) : null}

              {preview?.warnings.length ? (
                <div className="profile-evaluation-notice">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>
                    {preview.warnings.map((warning) => <p key={warning}>{t(warning)}</p>)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : active ? (
            <div className="profile-evaluation-running" role="status" aria-live="polite">
              <div className="profile-evaluation-running__visual" aria-hidden="true">
                <LoaderCircle className="is-spinning" size={28} />
              </div>
              <strong>{t(statusLabel(run.status))}</strong>
              <p>{t(run.stage)}</p>
              <dl>
                <div><dt>{t("Profile")}</dt><dd>{run.profileName}</dd></div>
                <div><dt>{t("Agent")}</dt><dd>{run.targetName}</dd></div>
                <div><dt>{t("Project")}</dt><dd title={run.projectPath}>{run.projectPath}</dd></div>
              </dl>
            </div>
          ) : (
            <div className="profile-evaluation-result">
              {result ? (
                <div className="profile-evaluation-result__context">
                  <div>
                    <span>{result.profileName} · {result.targetName}</span>
                    <span title={result.projectPath}>
                      {projectName} · {result.projectRevision.slice(0, 7)} · {formatDate(result.completedAt)}
                    </span>
                  </div>
                  <div>
                    <span>{t("Task")}</span>
                    <p>{result.prompt}</p>
                  </div>
                </div>
              ) : null}
              <div className="profile-evaluation-result__summary">
                <span><Clock3 size={14} />{result ? formatDuration(result.durationMs) : t("Unavailable")}</span>
                <span><FileDiff size={14} />{t(changedFilesLabel, { count: result?.changedFiles.length ?? 0 })}</span>
                <span>{t("CLI exit {{code}}", { code: result?.exitCode ?? t("Unavailable") })}</span>
                <span>{tokenSummary}</span>
              </div>
              {run.error ? (
                <div className="profile-evaluation-notice is-error">
                  <XCircle size={16} />
                  <p>{run.error}</p>
                </div>
              ) : null}
              {result?.fidelity === "partial" ? (
                <div className="profile-evaluation-notice is-warning">
                  <AlertTriangle size={16} />
                  <p>{t("External tools and MCPs were disabled for this local-only evaluation.")}</p>
                </div>
              ) : null}
              <div className="profile-evaluation-tabs" role="tablist" aria-label={t("Evaluation result views")}>
                {(["response", "changes", "details"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={resultTab === tab}
                    className={resultTab === tab ? "is-active" : ""}
                    onClick={() => setResultTab(tab)}
                  >
                    {t(resultTabLabel(tab))}
                  </button>
                ))}
              </div>
              <div className="profile-evaluation-result__panel" role="tabpanel">
                {resultTab === "response" ? (
                  result?.finalResponse ? (
                    <div className="profile-evaluation-response">
                      <div className="profile-evaluation-response__toolbar">
                        <Button
                          size="compact"
                          icon={responseCopied ? <Check size={14} /> : <Copy size={14} />}
                          onClick={() => {
                            void window.agentEnv.copyText(result.finalResponse).then(() => {
                              setResponseCopied(true);
                            }).catch((unknownError) => {
                              setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                            });
                          }}
                        >
                          {t(responseCopied ? "Response copied" : "Copy response")}
                        </Button>
                      </div>
                      <ConversationMarkdown
                        text={result.finalResponse}
                        onOpenExternal={(href) => {
                          void window.agentEnv.openExternalUrl(href).catch((unknownError) => {
                            setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
                          });
                        }}
                      />
                    </div>
                  ) : <p className="profile-evaluation-empty">{t("No final response was reported.")}</p>
                ) : resultTab === "changes" ? (
                  changes.length > 0 ? (
                    <div className="profile-evaluation-changes">
                      <div className="profile-evaluation-change-toolbar">
                        <select
                          aria-label={t("Changed file")}
                          value={selectedChange?.path ?? ""}
                          onChange={(event) => setSelectedDiffPath(event.target.value)}
                        >
                          {changes.map((change) => (
                            <option key={change.path} value={change.path}>{change.path}</option>
                          ))}
                        </select>
                        <Button
                          size="compact"
                          icon={<Expand size={14} />}
                          onClick={() => setDiffWorkspaceOpen(true)}
                        >
                          {t("Expand")}
                        </Button>
                      </div>
                      {selectedChange ? (
                        <DiffViewer path={selectedChange.path} diff={selectedChange.diff} />
                      ) : null}
                    </div>
                  ) : <p className="profile-evaluation-empty">{t("No file changes.")}</p>
                ) : result ? (
                  <dl className="profile-evaluation-details">
                    <div><dt>{t("Profile hash")}</dt><dd><code>{result.profileContentHash}</code></dd></div>
                    <div><dt>{t("Project revision")}</dt><dd><code>{result.projectRevision}</code></dd></div>
                    <div><dt>{t("Project")}</dt><dd>{result.projectPath}</dd></div>
                    <div><dt>{t("Completed at")}</dt><dd>{formatDate(result.completedAt)}</dd></div>
                    <div><dt>{t("CLI version")}</dt><dd>{result.cliVersion ?? t("Unavailable")}</dd></div>
                    <div><dt>{t("Model")}</dt><dd>{result.model ?? t("Unavailable")}</dd></div>
                    <div><dt>{t("Input tokens")}</dt><dd>{result.usage?.inputTokens !== undefined ? formatNumber(result.usage.inputTokens) : t("Unavailable")}</dd></div>
                    <div><dt>{t("Cached input")}</dt><dd>{result.usage?.cachedInputTokens !== undefined ? formatNumber(result.usage.cachedInputTokens) : t("Unavailable")}</dd></div>
                    <div><dt>{t("Output tokens")}</dt><dd>{result.usage?.outputTokens !== undefined ? formatNumber(result.usage.outputTokens) : t("Unavailable")}</dd></div>
                    <div><dt>{t("Reasoning tokens")}</dt><dd>{result.usage?.reasoningTokens !== undefined ? formatNumber(result.usage.reasoningTokens) : t("Unavailable")}</dd></div>
                    <div><dt>{t("Reported cost")}</dt><dd>{result.usage?.reportedCostUsd !== undefined ? `$${result.usage.reportedCostUsd.toFixed(4)}` : t("Unavailable")}</dd></div>
                  </dl>
                ) : null}
              </div>
            </div>
          )}

          {error ? (
            <div className="profile-evaluation-notice is-error" role="alert">
              <XCircle size={16} />
              <p>{error}</p>
              {!run && projectPath && !preview ? (
                <Button
                  size="compact"
                  busy={previewing}
                  onClick={() => void reviewProject(projectPath)}
                >
                  {t("Review again")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="ui-dialog-footer">
          {!run ? (
            <>
              <Button disabled={starting} onClick={onClose}>{t("Cancel")}</Button>
              <Button
                variant="primary"
                busy={starting}
                disabled={previewing || starting || !preview || !prompt.trim() || supportedTargets.length === 0}
                icon={<FlaskConical size={15} />}
                onClick={() => void start()}
              >
                {t("Run evaluation")}
              </Button>
            </>
          ) : active ? (
            <Button
              variant="secondary"
              disabled={!run.canCancel}
              icon={<Square size={13} fill="currentColor" />}
              onClick={() => void cancel()}
            >
              {t(cancelLabel)}
            </Button>
          ) : (
            <>
              <Button onClick={onClose}>{t("Close")}</Button>
              <Button icon={<RotateCcw size={15} />} onClick={runAgain}>
                {t("Run again")}
              </Button>
            </>
          )}
        </footer>
      </ModalFrame>
      <DiffWorkspaceDialog
        changes={changes}
        open={diffWorkspaceOpen}
        returnFocusRef={dialogRef}
        title={t("Evaluation changes")}
        onClose={() => setDiffWorkspaceOpen(false)}
      />
    </>
  );
};
