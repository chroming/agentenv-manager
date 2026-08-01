// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileEvaluationDialog } from "../../src/renderer/components/ProfileEvaluationDialog";
import type {
  AgentEnvApi,
  OneShotEvaluationPreview,
  OneShotEvaluationRun,
  ProfileDetail,
  TargetInfo
} from "../../src/shared/types";

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

const preview = (overrides: Partial<OneShotEvaluationPreview> = {}): OneShotEvaluationPreview => ({
  previewId: "preview-1",
  profileId: profile.id,
  profileName: profile.manifest.name,
  profileContentHash: "profile-hash",
  targetId: target.id,
  targetName: target.name,
  cliVersion: "1.18.0",
  projectPath: "/Users/test/project",
  projectRevision: "91ad3e2f00",
  projectHasUncommittedChanges: false,
  resources: {
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

const completedRun = (): OneShotEvaluationRun => ({
  runId: "run-1",
  profileId: profile.id,
  profileName: profile.manifest.name,
  targetId: target.id,
  targetName: target.name,
  projectPath: "/Users/test/project",
  projectRevision: "91ad3e2f00",
  status: "completed",
  stage: "Evaluation completed",
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
    cliVersion: "1.18.0",
    model: "openai/test",
    projectPath: "/Users/test/project",
    projectRevision: "91ad3e2f00",
    prompt: "Add a test",
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:00:02.000Z",
    durationMs: 2_000,
    exitCode: 0,
    finalResponse: "Implemented the requested test.",
    diff: "diff --git a/test.ts b/test.ts\n+new test\n",
    fileDiffs: [{
      path: "test.ts",
      action: "add",
      diff: "diff --git a/test.ts b/test.ts\nnew file mode 100644\n+new test\n"
    }],
    changedFiles: ["test.ts"],
    usage: { inputTokens: 20, outputTokens: 8 },
    fidelity: "partial",
    warnings: []
  }
});

const installApi = (overrides: Partial<AgentEnvApi> = {}) => {
  const api = {
    readEvaluation: vi.fn(async () => undefined),
    selectEvaluationProject: vi.fn(async () => "/Users/test/project"),
    previewEvaluation: vi.fn(async () => preview()),
    startEvaluation: vi.fn(async () => completedRun()),
    cancelEvaluation: vi.fn(),
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
  it("reviews the saved environment, runs once, and presents response, changes, and usage", async () => {
    const api = installApi();
    render(
      <ProfileEvaluationDialog
        open
        profile={profile}
        targets={[target]}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Uses the Agent account and model quota/))
      .toHaveTextContent("External tools, MCPs, and project Agent files are excluded");
    fireEvent.click(screen.getByRole("button", { name: "Choose Git project" }));
    await screen.findByText("Revision 91ad3e2");
    expect(api.previewEvaluation).toHaveBeenCalledWith({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: "/Users/test/project",
      excludeMcp: true
    });
    expect(screen.queryByRole("combobox", { name: "Agent" })).not.toBeInTheDocument();
    expect(screen.getByText("Use Profile · 8")).toBeInTheDocument();
    expect(screen.getByText("Excluded for safe evaluation · 2")).toBeInTheDocument();
    expect(screen.getByText("Restricted Profile")).toBeInTheDocument();
    const runButton = screen.getByRole("button", { name: "Run evaluation" });
    expect(runButton).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Add a test" }
    });
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    await screen.findByText("Evaluation completed");
    expect(screen.getByText("Implemented the requested test.")).toBeInTheDocument();
    expect(screen.getByText("Add a test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy response" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith("Implemented the requested test."));
    expect(screen.getByRole("button", { name: "Response copied" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Changes" }));
    expect(await screen.findByRole("table", { name: "Formatted diff for test.ts" }))
      .toHaveTextContent("new test");
    fireEvent.click(screen.getByRole("tab", { name: "Run details" }));
    const details = screen.getByRole("tabpanel");
    expect(within(details).getByText("20")).toBeInTheDocument();
    expect(within(details).getByText("8")).toBeInTheDocument();
  });

  it("restores the latest result for this Profile and keeps its inputs for another run", async () => {
    const api = installApi({
      readEvaluation: vi.fn(async () => completedRun())
    });
    render(
      <ProfileEvaluationDialog
        open
        profile={profile}
        targets={[target]}
        onClose={vi.fn()}
      />
    );

    await screen.findByText("Latest evaluation");
    expect(screen.getByText("Implemented the requested test.")).toBeInTheDocument();
    expect(screen.getByText(/project · 91ad3e2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));

    await waitFor(() => expect(api.previewEvaluation).toHaveBeenCalledWith({
      profileId: "daily-coding",
      targetId: "opencode",
      projectPath: "/Users/test/project",
      excludeMcp: true
    }));
    expect(screen.getByRole("textbox", { name: "Task" })).toHaveValue("Add a test");
  });

  it("keeps launch progress local, blocks duplicate runs, and prevents orphaned dismissal", async () => {
    let finishStart!: (run: OneShotEvaluationRun) => void;
    const startEvaluation = vi.fn(() => new Promise<OneShotEvaluationRun>((resolve) => {
      finishStart = resolve;
    }));
    const onClose = vi.fn();
    installApi({ startEvaluation });
    render(
      <ProfileEvaluationDialog
        open
        profile={profile}
        targets={[target]}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose Git project" }));
    await screen.findByText("Revision 91ad3e2");
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Add a test" }
    });
    const runButton = screen.getByRole("button", { name: "Run evaluation" });
    fireEvent.click(runButton);

    expect(runButton).toHaveAttribute("aria-busy", "true");
    expect(runButton).toBeDisabled();
    expect(startEvaluation).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finishStart(completedRun()));
    await screen.findByText("Evaluation completed");
  });

  it("turns a stale start failure into an explicit re-review action", async () => {
    const previewEvaluation = vi.fn()
      .mockResolvedValueOnce(preview())
      .mockResolvedValueOnce(preview({ previewId: "preview-refreshed" }));
    installApi({
      previewEvaluation,
      startEvaluation: vi.fn().mockRejectedValue(
        new Error("Project changed after evaluation preview. Review it again.")
      )
    });
    render(
      <ProfileEvaluationDialog
        open
        profile={profile}
        targets={[target]}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose Git project" }));
    await screen.findByText("Revision 91ad3e2");
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Add a test" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Project changed after evaluation preview");
    const reviewAgain = screen.getByRole("button", { name: "Review again" });
    fireEvent.click(reviewAgain);
    await waitFor(() => expect(previewEvaluation).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run evaluation" })).toBeEnabled();
  });

  it("presents the fixed restricted environment and blocks dismissal while a run is active", async () => {
    const activeRun: OneShotEvaluationRun = {
      runId: "run-active",
      profileId: profile.id,
      profileName: profile.manifest.name,
      targetId: target.id,
      targetName: target.name,
      projectPath: "/Users/test/project",
      projectRevision: "91ad3e2f00",
      status: "running",
      stage: "Running",
      startedAt: "2026-08-01T00:00:00.000Z",
      canCancel: true
    };
    const onClose = vi.fn();
    const cancellingRun: OneShotEvaluationRun = {
      ...activeRun,
      status: "cancelling",
      stage: "Cancelling evaluation",
      canCancel: false
    };
    const previewEvaluation = vi.fn().mockResolvedValue(preview());
    const api = installApi({
      previewEvaluation,
      startEvaluation: vi.fn(async () => activeRun),
      readEvaluation: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue(activeRun),
      cancelEvaluation: vi.fn(async () => cancellingRun)
    });
    render(
      <ProfileEvaluationDialog
        open
        profile={profile}
        targets={[target]}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose Git project" }));
    await screen.findByText("Restricted Profile");
    expect(previewEvaluation).toHaveBeenLastCalledWith(expect.objectContaining({ excludeMcp: true }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task" }), {
      target: { value: "Review code" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Run evaluation" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Running");
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel evaluation" }));
    await waitFor(() => expect(api.cancelEvaluation).toHaveBeenCalledWith("run-active"));
  });

  it("keeps review progress with the initiating control instead of spinning Run", async () => {
    let finishPreview!: (value: OneShotEvaluationPreview) => void;
    installApi({
      previewEvaluation: vi.fn(() => new Promise<OneShotEvaluationPreview>((resolve) => {
        finishPreview = resolve;
      }))
    });
    render(
      <ProfileEvaluationDialog
        open
        profile={profile}
        targets={[target]}
        onClose={vi.fn()}
      />
    );

    const choose = screen.getByRole("button", { name: "Choose Git project" });
    fireEvent.click(choose);
    await waitFor(() => expect(choose).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("button", { name: "Run evaluation" }))
      .toHaveAttribute("aria-busy", "false");

    await act(async () => finishPreview(preview()));
    await screen.findByText("Restricted Profile");
  });
});
