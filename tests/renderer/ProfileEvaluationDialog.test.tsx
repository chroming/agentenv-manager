// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileEvaluationDialog } from "../../src/renderer/components/ProfileEvaluationDialog";
import type {
  OneShotEvaluationPreview,
  OneShotEvaluationRun,
  OneShotEvaluationSideResult,
  OneShotEvaluationWorkspaceSummary
} from "../../src/shared/evaluations";
import type { AgentEnvApi, ProfileDetail, TargetInfo } from "../../src/shared/types";

const profile: ProfileDetail = {
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    name: "Daily Coding",
    description: "",
    preferredTargetId: "opencode",
    version: 2
  },
  instructions: "# Instructions\n",
  resources: {
    skills: [],
    mcpByTarget: { opencode: { mode: "manage", selections: [] } }
  }
};

const target = {
  id: "opencode",
  name: "OpenCode",
  description: "",
  instructionsLabel: "AGENTS.md",
  configLabel: "opencode.jsonc",
  configLanguage: "jsonc",
  realWritesEnabled: true,
  capabilities: {
    instructions: true,
    skills: true,
    mcpTransports: ["stdio"],
    disabledSkillPaths: false,
    evaluation: true
  },
  paths: {},
  health: {
    status: "ready",
    installationFound: true,
    installationEvidence: [],
    executablePath: "/usr/local/bin/opencode",
    executableFound: true,
    canWrite: true,
    summary: "Ready",
    checks: []
  },
  conversationCapabilities: {}
} as unknown as TargetInfo;

const emptyWorkspace: OneShotEvaluationWorkspaceSummary = {
  kind: "empty",
  name: "Empty Workspace",
  contentHash: "empty-workspace-hash",
  fileCount: 0,
  totalBytes: 0,
  omittedCount: 0
};

const folderWorkspace: OneShotEvaluationWorkspaceSummary = {
  kind: "folder",
  path: "/Users/test/notes",
  name: "notes",
  contentHash: "folder-workspace-hash",
  fileCount: 12,
  totalBytes: 4_096,
  omittedCount: 1
};

const preview = (overrides: Partial<OneShotEvaluationPreview> = {}): OneShotEvaluationPreview => ({
  previewId: "preview-1",
  profileId: profile.id,
  profileName: profile.manifest.name,
  profileContentHash: "profile-hash",
  targetId: target.id,
  targetName: target.name,
  cliVersion: "1.18.0",
  workspace: emptyWorkspace,
  runsRequired: 2,
  baselineSource: "fresh-run",
  currentResources: {
    instructions: { mode: "ignore", includedCount: 1 },
    skills: { mode: "ignore", includedCount: 5 },
    mcp: { mode: "ignore", includedCount: 0 }
  },
  proposedResources: {
    instructions: { mode: "manage", includedCount: 1 },
    skills: { mode: "manage", includedCount: 8 },
    mcp: { mode: "manage", includedCount: 0, omittedCount: 2 }
  },
  fidelity: "partial",
  requiresMcpExclusion: false,
  warnings: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides
});

const side = (
  environment: "current" | "proposed",
  overrides: Partial<OneShotEvaluationSideResult> = {}
): OneShotEvaluationSideResult => ({
  environment,
  environmentContentHash: `${environment}-environment-hash`,
  skillContentHashes: environment === "proposed" ? { reviewer: "skill-hash" } : {},
  cliVersion: "1.18.0",
  model: "openai/test",
  startedAt: "2026-08-01T00:00:00.000Z",
  completedAt: "2026-08-01T00:00:02.000Z",
  durationMs: environment === "current" ? 1_500 : 2_000,
  exitCode: 0,
  finalResponse: environment === "current" ? "Current response." : "Proposed response.",
  diff: environment === "current" ? "" : "diff --git a/test.ts b/test.ts\n+new test\n",
  fileDiffs: environment === "current" ? [] : [{
    path: "test.ts",
    action: "add",
    diff: "diff --git a/test.ts b/test.ts\nnew file mode 100644\n+new test\n"
  }],
  changedFiles: environment === "current" ? [] : ["test.ts"],
  usage: environment === "current"
    ? { totalTokens: 20 }
    : { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
  fidelity: "partial",
  warnings: [],
  ...overrides
});

const completedRun = (): OneShotEvaluationRun => ({
  runId: "run-1",
  profileId: profile.id,
  profileName: profile.manifest.name,
  targetId: target.id,
  targetName: target.name,
  workspace: emptyWorkspace,
  status: "completed",
  stage: "Comparison completed",
  startedAt: "2026-08-01T00:00:00.000Z",
  canCancel: false,
  result: {
    runId: "run-1",
    profileId: profile.id,
    profileName: profile.manifest.name,
    profileContentHash: "profile-hash",
    skillContentHashes: { reviewer: "skill-hash" },
    targetId: target.id,
    targetName: target.name,
    workspace: emptyWorkspace,
    prompt: "Add a test",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:00:02.000Z",
    durationMs: 3_500,
    current: side("current"),
    proposed: side("proposed"),
    delta: {
      diff: "diff --git a/test.ts b/test.ts\n+new test\n",
      fileDiffs: [{
        path: "test.ts",
        action: "add",
        diff: "diff --git a/test.ts b/test.ts\nnew file mode 100644\n+new test\n"
      }],
      changedFiles: ["test.ts"]
    },
    baselineSource: "fresh-run",
    comparisonSignature: "comparison-hash",
    fidelity: "partial",
    warnings: []
  }
});

const installApi = (overrides: Partial<AgentEnvApi> = {}) => {
  const api = {
    selectComparisonWorkspace: vi.fn(async () => "/Users/test/notes"),
    previewProfileComparison: vi.fn(async (input) => preview({
      workspace: input.workspace?.kind === "folder" ? folderWorkspace : emptyWorkspace
    })),
    startProfileComparison: vi.fn(async () => completedRun()),
    readProfileComparison: vi.fn(async () => undefined),
    cancelProfileComparison: vi.fn(),
    copyText: vi.fn(async () => undefined),
    openExternalUrl: vi.fn(async () => undefined)
  } as unknown as AgentEnvApi;
  Object.assign(api, overrides);
  window.agentEnv = api;
  return api;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProfileEvaluationDialog", () => {
  it("compares Current and Proposed in an empty Workspace and exposes the result evidence", async () => {
    const api = installApi();
    const onReviewApply = vi.fn();
    render(
      <ProfileEvaluationDialog
        open
        profile={profile}
        target={target}
        onClose={vi.fn()}
        onReviewApply={onReviewApply}
      />
    );

    await screen.findByText("Temporary empty Workspace");
    expect(api.previewProfileComparison).toHaveBeenCalledWith({
      profileId: "daily-coding",
      targetId: "opencode",
      workspace: { kind: "empty" },
      excludeMcp: true
    });
    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument();
    expect(screen.queryByText("Agent", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Empty" })).toHaveClass(
      "ui-segmented-control__option"
    );
    expect(screen.getByRole("radio", { name: "Local folder" })).toHaveClass(
      "ui-segmented-control__option"
    );
    expect(screen.getByText("Runs both setups separately and may consume two model calls."))
      .toBeInTheDocument();
    expect(screen.getByText("Keep current · 5")).toBeInTheDocument();
    expect(screen.getByText("Use Profile · 8")).toBeInTheDocument();

    const runButton = screen.getByRole("button", { name: "Run comparison" });
    expect(runButton).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Add a test" }
    });
    fireEvent.click(runButton);

    await screen.findByText("Comparison completed");
    const overview = screen.getByRole("tabpanel");
    expect(screen.getByRole("tablist", { name: "Comparison result views" }))
      .toHaveClass("ui-segmented-control");
    expect(within(overview).getByText("Agent now")).toBeInTheDocument();
    expect(within(overview).getByText("With Profile")).toBeInTheDocument();
    expect(within(overview).getByText("1 output file differs")).toBeInTheDocument();
    expect(within(overview).getByText("20")).toBeInTheDocument();
    expect(within(overview).getByText("28")).toBeInTheDocument();
    expect(within(overview).getByText("+8")).toHaveClass("is-different");

    fireEvent.click(screen.getByRole("tab", { name: "Responses" }));
    expect(screen.getByText("Current response.")).toBeInTheDocument();
    expect(screen.getByText("Proposed response.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Copy response" })[1]);
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith("Proposed response."));

    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(screen.getByRole("tab", { name: "Profile vs Agent" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByText("Only with Profile")).toBeInTheDocument();
    expect(screen.getByText("Only with Agent now")).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "Formatted diff for test.ts" }))
      .toHaveTextContent("new test");

    fireEvent.click(screen.getByRole("tab", { name: "Run details" }));
    expect(screen.getByText("CLI version")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getAllByText("1.18.0")).toHaveLength(1);
    expect(screen.getAllByText("openai/test")).toHaveLength(1);
    expect(screen.queryByText("Current CLI")).not.toBeInTheDocument();
    expect(screen.queryByText("Proposed CLI")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review Apply" }));
    expect(onReviewApply).toHaveBeenCalledTimes(1);
  });

  it("accepts a normal local folder without requiring Git", async () => {
    const api = installApi();
    render(
      <ProfileEvaluationDialog open profile={profile} target={target} onClose={vi.fn()} />
    );

    await screen.findByText("Temporary empty Workspace");
    fireEvent.click(screen.getByRole("radio", { name: "Local folder" }));
    await screen.findByText("/Users/test/notes");
    expect(screen.getByText("12 files · 4.0 KB · 1 excluded")).toBeInTheDocument();
    expect(screen.queryByText(/Revision/)).not.toBeInTheDocument();
    expect(api.previewProfileComparison).toHaveBeenLastCalledWith({
      profileId: "daily-coding",
      targetId: "opencode",
      workspace: { kind: "folder", path: "/Users/test/notes" },
      excludeMcp: true
    });
  });

  it("keeps start progress local and cannot be dismissed while a comparison starts", async () => {
    let finishStart!: (run: OneShotEvaluationRun) => void;
    const startProfileComparison = vi.fn(() => new Promise<OneShotEvaluationRun>((resolve) => {
      finishStart = resolve;
    }));
    const onClose = vi.fn();
    installApi({ startProfileComparison });
    render(
      <ProfileEvaluationDialog open profile={profile} target={target} onClose={onClose} />
    );
    await screen.findByText("Temporary empty Workspace");
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Add a test" }
    });
    const runButton = screen.getByRole("button", { name: "Run comparison" });
    fireEvent.click(runButton);

    expect(runButton).toHaveAttribute("aria-busy", "true");
    expect(runButton).toBeDisabled();
    expect(startProfileComparison).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finishStart(completedRun()));
    await screen.findByText("Comparison completed");
  });

  it("polls the active run and supports cancellation without closing the dialog", async () => {
    const activeRun: OneShotEvaluationRun = {
      runId: "run-active",
      profileId: profile.id,
      profileName: profile.manifest.name,
      targetId: target.id,
      targetName: target.name,
      workspace: emptyWorkspace,
      status: "running",
      stage: "Running current setup",
      startedAt: "2026-08-01T00:00:00.000Z",
      canCancel: true
    };
    const cancellingRun = {
      ...activeRun,
      status: "cancelling" as const,
      stage: "Cancelling comparison",
      canCancel: false
    };
    const api = installApi({
      startProfileComparison: vi.fn(async () => activeRun),
      readProfileComparison: vi.fn(async () => activeRun),
      cancelProfileComparison: vi.fn(async () => cancellingRun)
    });
    const onClose = vi.fn();
    render(
      <ProfileEvaluationDialog open profile={profile} target={target} onClose={onClose} />
    );
    await screen.findByText("Temporary empty Workspace");
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Review code" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run comparison" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Running current setup");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel comparison" }));
    await waitFor(() => expect(api.cancelProfileComparison).toHaveBeenCalledWith("run-active"));
  });

  it("turns a stale Preview failure into an explicit review action", async () => {
    const previewProfileComparison = vi.fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(preview({ previewId: "preview-refreshed" }));
    installApi({
      previewProfileComparison,
      startProfileComparison: vi.fn().mockRejectedValue(
        new Error("Workspace changed after comparison Preview. Review it again.")
      )
    });
    render(
      <ProfileEvaluationDialog open profile={profile} target={target} onClose={vi.fn()} />
    );
    await screen.findByText("Temporary empty Workspace");
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Add a test" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run comparison" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Workspace changed after comparison Preview");
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    await waitFor(() => expect(previewProfileComparison).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
