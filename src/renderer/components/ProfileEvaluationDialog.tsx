import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Columns2,
  Copy,
  Expand,
  FileDiff,
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
  OneShotEvaluationFileDiff,
  OneShotEvaluationPreview,
  OneShotEvaluationRun,
  OneShotEvaluationSideResult,
  OneShotEvaluationWorkspaceInput
} from "../../shared/evaluations";
import { oneShotEvaluationIsActive } from "../../shared/evaluations";
import type { PlannedFileChange, ProfileDetail, TargetInfo } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { ConversationMarkdown } from "./ConversationMarkdown";
import { DiffViewer } from "./DiffViewer";
import { DiffWorkspaceDialog } from "./DiffWorkspaceDialog";
import { Button, IconButton, ModalFrame } from "./ui";

interface ProfileEvaluationDialogProps {
  open: boolean;
  profile: ProfileDetail;
  target: TargetInfo;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onClose(): void;
  onReviewApply?(): void;
}

type ResultTab = "overview" | "responses" | "changes" | "details";
type ChangeScope = "delta" | "current" | "proposed";

const modeLabel = (mode: string) =>
  mode === "manage" ? "Use Profile" : mode === "disable" ? "Turn off" : "Keep current";

const statusLabel = (status: OneShotEvaluationRun["status"]) => ({
  preparing: "Preparing",
  running: "Running",
  cancelling: "Cancelling",
  completed: "Comparison completed",
  incomplete: "Comparison incomplete",
  "failed-to-run": "Failed to run",
  cancelled: "Cancelled"
})[status];

const formatDuration = (milliseconds: number) => {
  if (milliseconds > 0 && milliseconds < 1_000) return "<1s";
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const toPlannedChanges = (changes: OneShotEvaluationFileDiff[]): PlannedFileChange[] =>
  changes.map((change) => ({
    path: change.path,
    before: "",
    after: "",
    diff: change.diff,
    action: change.action === "remove" ? "remove" : "write"
  }));

const totalTokens = (side: OneShotEvaluationSideResult) => {
  if (side.usage?.totalTokens !== undefined) return side.usage.totalTokens;
  if (side.usage?.inputTokens === undefined && side.usage?.outputTokens === undefined) return undefined;
  return (side.usage.inputTokens ?? 0) + (side.usage.outputTokens ?? 0);
};

export const ProfileEvaluationDialog = ({
  open,
  profile,
  target,
  returnFocusRef,
  onClose,
  onReviewApply
}: ProfileEvaluationDialogProps) => {
  const { formatDate, formatNumber, t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const [workspaceInput, setWorkspaceInput] = useState<OneShotEvaluationWorkspaceInput>({
    kind: "empty"
  });
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<OneShotEvaluationPreview>();
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [run, setRun] = useState<OneShotEvaluationRun>();
  const [error, setError] = useState("");
  const [resultTab, setResultTab] = useState<ResultTab>("overview");
  const [changeScope, setChangeScope] = useState<ChangeScope>("delta");
  const [selectedDiffPath, setSelectedDiffPath] = useState("");
  const [diffWorkspaceOpen, setDiffWorkspaceOpen] = useState(false);
  const [copiedSide, setCopiedSide] = useState<"current" | "proposed">();
  const active = Boolean(run && oneShotEvaluationIsActive(run.status));
  const locked = active || starting;
  const result = run?.result;
  const terminal = Boolean(run && !oneShotEvaluationIsActive(run.status));
  const activeStage = run?.stage.toLowerCase() ?? "";
  const currentStageActive = activeStage.includes("current");
  const proposedStageActive = activeStage.includes("proposed");
  const resultsStageActive = activeStage === "comparing results" || activeStage.includes("removing");

  const dismiss = () => {
    if (!locked) onClose();
  };

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef,
    fallbackFocusRef: returnFocusRef,
    onDismiss: dismiss,
    dismissDisabled: locked || diffWorkspaceOpen
  });

  const reviewWorkspace = async (input: OneShotEvaluationWorkspaceInput) => {
    setPreviewing(true);
    setError("");
    setPreview(undefined);
    try {
      const next = await window.agentEnv.previewProfileComparison({
        profileId: profile.id,
        targetId: target.id,
        workspace: input,
        excludeMcp: true
      });
      setWorkspaceInput(input);
      setPreview(next);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setPreviewing(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setWorkspaceInput({ kind: "empty" });
    setPrompt("");
    setPreview(undefined);
    setRun(undefined);
    setError("");
    setResultTab("overview");
    setChangeScope("delta");
    setSelectedDiffPath("");
    setCopiedSide(undefined);
    void reviewWorkspace({ kind: "empty" });
  }, [open, profile.id, target.id]);

  useEffect(() => {
    if (!run || !oneShotEvaluationIsActive(run.status)) return undefined;
    const timer = window.setInterval(() => {
      void window.agentEnv.readProfileComparison({ runId: run.runId }).then((next) => {
        if (next) setRun(next);
      }).catch((unknownError) => {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    }, 300);
    return () => window.clearInterval(timer);
  }, [run?.runId, run?.status]);

  useEffect(() => {
    if (!result) return;
    const selected = changeScope === "current"
      ? result.current.fileDiffs
      : changeScope === "proposed"
        ? result.proposed.fileDiffs
        : result.delta.fileDiffs;
    if (!selected.some((change) => change.path === selectedDiffPath)) {
      setSelectedDiffPath(selected[0]?.path ?? "");
    }
  }, [changeScope, result, selectedDiffPath]);

  const chooseFolder = async () => {
    setError("");
    try {
      const path = await window.agentEnv.selectComparisonWorkspace();
      if (path) await reviewWorkspace({ kind: "folder", path });
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const start = async () => {
    if (!preview || !prompt.trim() || starting) return;
    setStarting(true);
    setError("");
    try {
      setRun(await window.agentEnv.startProfileComparison({
        previewId: preview.previewId,
        prompt
      }));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!run?.canCancel) return;
    try {
      setRun(await window.agentEnv.cancelProfileComparison(run.runId));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const runAgain = () => {
    setRun(undefined);
    setError("");
    setResultTab("overview");
    setChangeScope("delta");
    setSelectedDiffPath("");
    void reviewWorkspace(workspaceInput);
  };

  const copyResponse = async (side: OneShotEvaluationSideResult) => {
    try {
      await window.agentEnv.copyText(side.finalResponse);
      setCopiedSide(side.environment);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const changes = useMemo(() => {
    if (!result) return [];
    return toPlannedChanges(
      changeScope === "current"
        ? result.current.fileDiffs
        : changeScope === "proposed"
          ? result.proposed.fileDiffs
          : result.delta.fileDiffs
    );
  }, [changeScope, result]);
  const selectedChange = changes.find((change) => change.path === selectedDiffPath) ?? changes[0];

  const resourceSummary = (scope: OneShotEvaluationPreview["proposedResources"]["skills"]) =>
    scope.mode === "disable"
      ? t("Turn off")
      : t("{{mode}} · {{count}}", {
          mode: t(modeLabel(scope.mode)),
          count: scope.includedCount
        });

  const sideSummary = (side: OneShotEvaluationSideResult) => ({
    tokens: totalTokens(side),
    changes: side.changedFiles.length,
    duration: formatDuration(side.durationMs)
  });

  return (
    <>
      <ModalFrame
        ariaLabel={t("Compare {{name}} on {{target}}", {
          name: profile.manifest.name,
          target: target.name
        })}
        className="profile-comparison-dialog ui-dialog-shell"
        dialogRef={dialogRef}
        dismissDisabled={locked}
        onDismiss={dismiss}
        suspended={diffWorkspaceOpen}
      >
        <header className="ui-dialog-header profile-comparison-dialog__header">
          <div className="profile-comparison-dialog__heading-icon" aria-hidden="true">
            {run?.status === "completed" ? (
              <CheckCircle2 size={19} />
            ) : run?.status === "failed-to-run" || run?.status === "incomplete" ? (
              <XCircle size={19} />
            ) : (
              <Columns2 size={19} />
            )}
          </div>
          <div className="ui-dialog-header__copy">
            <h2 className="ui-dialog-title">
              {terminal && run
                ? t(statusLabel(run.status))
                : t("Compare {{name}} on {{target}}", {
                    name: profile.manifest.name,
                    target: target.name
                  })}
            </h2>
            <p className="ui-dialog-description">
              {active
                ? t("Current and proposed setups run only inside separate temporary environments.")
                : terminal
                  ? t("Compare the responses and Workspace changes before applying this Profile.")
                  : t("Runs the current Agent setup and proposed Profile against the same task and Workspace snapshot.")}
            </p>
          </div>
          {!locked ? (
            <IconButton label={t("Close")} onClick={onClose}>
              <X size={17} />
            </IconButton>
          ) : null}
        </header>

        <div className="ui-dialog-body profile-comparison-dialog__body">
          {!run ? (
            <div className="profile-comparison-setup">
              <div className="profile-comparison-fields">
                <div className="profile-comparison-field">
                  <span className="profile-comparison-field__label">{t("Agent")}</span>
                  <span className="profile-comparison-static-value">{target.name}</span>
                </div>
                <div className="profile-comparison-field">
                  <span className="profile-comparison-field__label">{t("Workspace")}</span>
                  <div
                    className="profile-comparison-workspace-choice ui-segmented-control"
                    role="radiogroup"
                    aria-label={t("Workspace")}
                  >
                    <button
                      ref={initialFocusRef}
                      className={`ui-segmented-control__option${workspaceInput.kind === "empty" ? " is-selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={workspaceInput.kind === "empty"}
                      disabled={previewing || starting}
                      onClick={() => void reviewWorkspace({ kind: "empty" })}
                    >
                      {t("Empty")}
                    </button>
                    <button
                      className={`ui-segmented-control__option${workspaceInput.kind === "folder" ? " is-selected" : ""}`}
                      type="button"
                      role="radio"
                      aria-checked={workspaceInput.kind === "folder"}
                      disabled={previewing || starting}
                      onClick={() => void chooseFolder()}
                    >
                      <FolderOpen size={14} />
                      {workspaceInput.kind === "folder" ? t("Change folder") : t("Local folder")}
                    </button>
                  </div>
                </div>
              </div>

              {preview ? (
                <div className="profile-comparison-workspace-summary">
                  <code
                    data-ui-overflow-detail="true"
                    title={preview.workspace.path}
                  >
                    {preview.workspace.path ?? t("Temporary empty Workspace")}
                  </code>
                  <span>
                    {preview.workspace.kind === "empty"
                      ? t("No project files")
                      : t("{{count}} files · {{size}}", {
                          count: preview.workspace.fileCount,
                          size: formatBytes(preview.workspace.totalBytes)
                        })}
                    {preview.workspace.omittedCount > 0
                      ? ` · ${t("{{count}} excluded", { count: preview.workspace.omittedCount })}`
                      : ""}
                  </span>
                  {preview.workspace.git ? (
                    <span>
                      {preview.workspace.git.branch ?? t("Detached")}
                      {" · "}{preview.workspace.git.revision.slice(0, 7)}
                      {preview.workspace.git.hasUncommittedChanges ? ` · ${t("Local changes included")}` : ""}
                    </span>
                  ) : null}
                </div>
              ) : null}

              <label className="profile-comparison-field profile-comparison-task">
                <span className="profile-comparison-field__label">{t("Task")}</span>
                <textarea
                  rows={4}
                  value={prompt}
                  disabled={starting}
                  placeholder={t("Describe the task both setups should perform…")}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </label>

              {preview ? (
                <section className="profile-comparison-environments" aria-label={t("Environment comparison") }>
                  <div className="profile-comparison-environments__header">
                    <span />
                    <strong>{t("Current setup")}</strong>
                    <strong>{t("Proposed Profile")}</strong>
                  </div>
                  {(["instructions", "skills", "mcp"] as const).map((kind) => (
                    <div className="profile-comparison-resource-row" key={kind}>
                      <span>{t(kind === "mcp" ? "MCP" : kind[0].toUpperCase() + kind.slice(1))}</span>
                      <span>{resourceSummary(preview.currentResources[kind])}</span>
                      <span>{kind === "mcp" && (preview.proposedResources.mcp.omittedCount ?? 0) > 0
                        ? t("Excluded · {{count}}", { count: preview.proposedResources.mcp.omittedCount ?? 0 })
                        : resourceSummary(preview.proposedResources[kind])}</span>
                    </div>
                  ))}
                </section>
              ) : null}

              {previewing ? (
                <div className="profile-comparison-reviewing" role="status">
                  <LoaderCircle className="is-spinning" size={15} />
                  <span>{t("Preparing comparison Preview…")}</span>
                </div>
              ) : null}

              {preview?.warnings.length ? (
                <div className="profile-comparison-notice is-warning">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>{preview.warnings.map((warning) => <p key={warning}>{t(warning)}</p>)}</div>
                </div>
              ) : null}

              {preview ? (
                <div className="profile-comparison-notice">
                  <Columns2 size={16} aria-hidden="true" />
                  <p>{preview.runsRequired === 2
                    ? t("Runs both setups separately and may consume two model calls.")
                    : t("Uses the verified current result and runs only the proposed Profile.")}</p>
                </div>
              ) : null}
            </div>
          ) : active ? (
            <div className="profile-comparison-running" role="status" aria-live="polite">
              <div className="profile-comparison-running__visual" aria-hidden="true">
                <LoaderCircle className="is-spinning" size={27} />
              </div>
              <strong>{t(statusLabel(run.status))}</strong>
              <p>{t(run.stage)}</p>
              <div className="profile-comparison-progress">
                <span className={currentStageActive
                  ? "is-active"
                  : proposedStageActive || resultsStageActive ? "is-complete" : ""}>
                  {t("Current setup")}
                </span>
                <span className={proposedStageActive
                  ? "is-active"
                  : resultsStageActive ? "is-complete" : ""}>
                  {t("Proposed Profile")}
                </span>
              </div>
              <dl>
                <div><dt>{t("Agent")}</dt><dd>{run.targetName}</dd></div>
                <div>
                  <dt>{t("Workspace")}</dt>
                  <dd data-ui-overflow-detail="true" title={run.workspace.path}>
                    {run.workspace.path ?? t("Empty Workspace")}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="profile-comparison-result">
              {result ? (
                <div className="profile-comparison-result__context">
                  <div>
                    <span>{result.profileName} · {result.targetName}</span>
                    <span>{result.workspace.name} · {formatDate(result.completedAt)}</span>
                  </div>
                  <p>{result.prompt}</p>
                </div>
              ) : null}

              {run.error ? (
                <div className="profile-comparison-notice is-error">
                  <XCircle size={16} />
                  <p>{run.error}</p>
                </div>
              ) : null}
              {result?.fidelity === "partial" ? (
                <div className="profile-comparison-notice is-warning">
                  <AlertTriangle size={16} />
                  <p>{t("Some Agent resources were excluded from both isolated environments.")}</p>
                </div>
              ) : null}

              <div className="profile-comparison-tabs" role="tablist" aria-label={t("Comparison result views") }>
                {(["overview", "responses", "changes", "details"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={resultTab === tab}
                    className={resultTab === tab ? "is-active" : ""}
                    onClick={() => setResultTab(tab)}
                  >
                    {t(tab === "overview" ? "Overview" : tab === "responses" ? "Responses" : tab === "changes" ? "Changes" : "Run details")}
                  </button>
                ))}
              </div>

              <div className="profile-comparison-result__panel" role="tabpanel">
                {resultTab === "overview" && result ? (
                  <div className="profile-comparison-side-grid">
                    {([result.current, result.proposed] as const).map((side) => {
                      const summary = sideSummary(side);
                      return (
                        <section className="profile-comparison-side" key={side.environment}>
                          <header>
                            <strong>{t(side.environment === "current" ? "Current setup" : "Proposed Profile")}</strong>
                            {side.error ? <span className="is-error">{t("Incomplete")}</span> : <span>{t("Completed")}</span>}
                          </header>
                          <dl>
                            <div><dt>{t("Duration")}</dt><dd>{summary.duration}</dd></div>
                            <div><dt>{t("Tokens")}</dt><dd>{summary.tokens === undefined ? t("Unavailable") : formatNumber(summary.tokens)}</dd></div>
                            <div><dt>{t("Files changed")}</dt><dd>{formatNumber(summary.changes)}</dd></div>
                            <div><dt>{t("CLI exit")}</dt><dd>{side.exitCode ?? t("Unavailable")}</dd></div>
                          </dl>
                          {side.error ? <p className="profile-comparison-side__error">{side.error}</p> : null}
                        </section>
                      );
                    })}
                  </div>
                ) : resultTab === "responses" && result ? (
                  <div className="profile-comparison-response-grid">
                    {([result.current, result.proposed] as const).map((side) => (
                      <section className="profile-comparison-response" key={side.environment}>
                        <header>
                          <strong>{t(side.environment === "current" ? "Current setup" : "Proposed Profile")}</strong>
                          {side.finalResponse ? (
                            <IconButton
                              label={t(copiedSide === side.environment ? "Response copied" : "Copy response")}
                              onClick={() => void copyResponse(side)}
                            >
                              {copiedSide === side.environment ? <Check size={14} /> : <Copy size={14} />}
                            </IconButton>
                          ) : null}
                        </header>
                        {side.finalResponse ? (
                          <ConversationMarkdown
                            text={side.finalResponse}
                            onOpenExternal={(href) => void window.agentEnv.openExternalUrl(href)}
                          />
                        ) : <p className="profile-comparison-empty">{t("No final response was reported.")}</p>}
                      </section>
                    ))}
                  </div>
                ) : resultTab === "changes" && result ? (
                  <div className="profile-comparison-changes">
                    <div className="profile-comparison-change-toolbar">
                      <div className="ui-segmented-control ui-segmented-control--compact" role="tablist">
                        {(["delta", "current", "proposed"] as const).map((scope) => (
                          <button
                            key={scope}
                            className={`ui-segmented-control__option${changeScope === scope ? " is-selected" : ""}`}
                            type="button"
                            role="tab"
                            aria-selected={changeScope === scope}
                            onClick={() => setChangeScope(scope)}
                          >
                            {t(scope === "delta" ? "Proposed vs Current" : scope === "current" ? "Current changes" : "Proposed changes")}
                          </button>
                        ))}
                      </div>
                      {changes.length > 0 ? (
                        <Button size="compact" icon={<Expand size={14} />} onClick={() => setDiffWorkspaceOpen(true)}>
                          {t("Expand")}
                        </Button>
                      ) : null}
                    </div>
                    {changes.length > 0 ? (
                      <>
                        <select
                          aria-label={t("Changed file")}
                          value={selectedChange?.path ?? ""}
                          onChange={(event) => setSelectedDiffPath(event.target.value)}
                        >
                          {changes.map((change) => <option key={change.path}>{change.path}</option>)}
                        </select>
                        {selectedChange ? <DiffViewer path={selectedChange.path} diff={selectedChange.diff} /> : null}
                      </>
                    ) : <p className="profile-comparison-empty">{t("No file changes.")}</p>}
                  </div>
                ) : resultTab === "details" && result ? (
                  <dl className="profile-comparison-details">
                    <div><dt>{t("Profile hash")}</dt><dd><code>{result.profileContentHash}</code></dd></div>
                    <div><dt>{t("Workspace hash")}</dt><dd><code>{result.workspace.contentHash}</code></dd></div>
                    <div><dt>{t("Comparison signature")}</dt><dd><code>{result.comparisonSignature}</code></dd></div>
                    <div><dt>{t("Completed at")}</dt><dd>{formatDate(result.completedAt)}</dd></div>
                    <div><dt>{t("Current CLI")}</dt><dd>{result.current.cliVersion ?? t("Unavailable")}</dd></div>
                    <div><dt>{t("Proposed CLI")}</dt><dd>{result.proposed.cliVersion ?? t("Unavailable")}</dd></div>
                    <div><dt>{t("Current model")}</dt><dd>{result.current.model ?? t("Unavailable")}</dd></div>
                    <div><dt>{t("Proposed model")}</dt><dd>{result.proposed.model ?? t("Unavailable")}</dd></div>
                  </dl>
                ) : null}
              </div>
            </div>
          )}

          {error ? (
            <div className="profile-comparison-notice is-error" role="alert">
              <XCircle size={16} />
              <p>{error}</p>
              {!run ? (
                <Button size="compact" busy={previewing} onClick={() => void reviewWorkspace(workspaceInput)}>
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
                disabled={previewing || starting || !preview || !prompt.trim()}
                icon={<Columns2 size={15} />}
                onClick={() => void start()}
              >
                {t("Run comparison")}
              </Button>
            </>
          ) : active ? (
            <Button
              variant="secondary"
              disabled={!run.canCancel}
              icon={<Square size={13} fill="currentColor" />}
              onClick={() => void cancel()}
            >
              {t(run.status === "cancelling" ? "Cancelling" : "Cancel comparison")}
            </Button>
          ) : (
            <>
              <Button onClick={onClose}>{t("Close")}</Button>
              <Button icon={<RotateCcw size={15} />} onClick={runAgain}>{t("Run again")}</Button>
              {onReviewApply && run.status === "completed" ? (
                <Button
                  variant="primary"
                  icon={<FileDiff size={15} />}
                  onClick={() => {
                    onClose();
                    onReviewApply();
                  }}
                >
                  {t("Review Apply")}
                </Button>
              ) : null}
            </>
          )}
        </footer>
      </ModalFrame>
      <DiffWorkspaceDialog
        changes={changes}
        open={diffWorkspaceOpen}
        returnFocusRef={dialogRef}
        title={t("Comparison changes")}
        onClose={() => setDiffWorkspaceOpen(false)}
      />
    </>
  );
};
