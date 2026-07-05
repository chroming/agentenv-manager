// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  act
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, AppFeedback } from "../../src/renderer/App";
import type {
  AgentEnvApi,
  ProfileDetail,
  TargetInfo,
  TargetManagementState
} from "../../src/shared/types";

const profile: ProfileDetail = {
  id: "daily-coding",
  profileDir: "/tmp/profiles/daily-coding",
  manifest: {
    id: "daily-coding",
    targetId: "opencode",
    name: "Daily Coding",
    description: "Default",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "# Agent\n",
  configText: '{\n  "mcp": {}\n}\n',
  assetPolicy: {
    ownedDirs: [],
    ownedFiles: [],
    skillRefs: [],
    mcpRefs: [],
    disabledSkillPaths: []
  },
  contentHash: "profile-hash",
  targetContentHashes: {
    opencode: "profile-hash",
    codex: "codex-profile-hash",
    "claude-code": "claude-profile-hash"
  }
};

const preview = {
  id: "preview-1",
  profileId: "daily-coding",
  profileContentHash: "profile-hash",
  libraryVersions: { skills: {}, mcp: {} },
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  warnings: [
    "Unmanaged local skill kept: /tmp/home/.config/opencode/skills/manual-reviewer"
  ],
  errors: [],
  changes: [
    {
      path: "/tmp/home/.config/opencode/AGENTS.md",
      before: "# Old\n",
      after: "# Agent\n",
      diff: "--- AGENTS.md\n+++ AGENTS.md\n@@\n-# Old\n+# Agent\n"
    },
    {
      path: "/tmp/home/.config/opencode/opencode.jsonc",
      before: "{}\n",
      after: '{\n  "mcp": {}\n}\n',
      diff: "--- opencode.jsonc\n+++ opencode.jsonc\n@@\n-{}\n+{\"mcp\":{}}\n"
    }
  ],
  resourceChanges: [],
  liveFingerprints: {},
  resourceFingerprints: {},
  sourceFingerprints: {},
  targetState: { managedConfigKeys: [], managedMcpNames: [] }
};

const backup = {
  id: "2026-06-30T09-19-41-374Z",
  createdAt: "2026-06-30T09:19:41.374Z",
  fileCount: 2,
  operation: "apply" as const,
  targetId: "opencode",
  profileId: "daily-coding",
  profileName: "Daily Coding"
};

const rollbackPreview = {
  id: "rollback-1",
  backupId: backup.id,
  createdAt: "2026-06-30T00:00:00.000Z",
  warnings: [],
  errors: [],
  changes: [
    {
      path: "/tmp/home/.config/opencode/AGENTS.md",
      before: "# Agent\n",
      after: "# Old\n",
      diff: "--- AGENTS.md\n+++ AGENTS.md\n@@\n-# Agent\n+# Old\n"
    }
  ]
};

const target: TargetInfo = {
  id: "opencode",
  name: "OpenCode",
  description: "Manage OpenCode.",
  instructionsLabel: "AGENTS.md",
  configLabel: "opencode.jsonc",
  configLanguage: "jsonc",
  realWritesEnabled: true,
  executableName: "opencode",
  paths: {
    targetId: "opencode",
    configDir: "/tmp/home/.config/opencode",
    instructionsPath: "/tmp/home/.config/opencode/AGENTS.md",
    configPath: "/tmp/home/.config/opencode/opencode.jsonc",
    agentsDir: "/tmp/home/.config/opencode/agents",
    skillsDir: "/tmp/home/.config/opencode/skills"
  },
  health: {
    status: "ready",
    executableName: "opencode",
    executablePath: "/usr/local/bin/opencode",
    executableFound: true,
    canWrite: true,
    summary: "Ready",
    checks: [
      {
        id: "configDir",
        label: "Config directory",
        path: "/tmp/home/.config/opencode",
        exists: true,
        writable: true,
        required: true
      }
    ]
  }
};

const codexTarget: TargetInfo = {
  ...target,
  id: "codex",
  name: "Codex",
  description: "Manage Codex.",
  instructionsLabel: "AGENTS.md",
  configLabel: "config.toml",
  configLanguage: "toml",
  executableName: "codex",
  paths: {
    ...target.paths,
    targetId: "codex",
    configDir: "/tmp/home/.codex",
    instructionsPath: "/tmp/home/.codex/AGENTS.md",
    configPath: "/tmp/home/.codex/config.toml",
    agentsDir: "/tmp/home/.codex/agents",
    skillsDir: "/tmp/home/.codex/skills"
  }
};

const codexProfile: ProfileDetail = {
  ...profile,
  id: "codex-review",
  manifest: {
    ...profile.manifest,
    id: "codex-review",
    targetId: "codex",
    name: "Codex Review",
    description: "Review setup"
  },
  configText: "[mcp_servers.context7]\ncommand = \"npx\"\n"
};

const profileB: ProfileDetail = {
  ...profile,
  id: "profile-b",
  manifest: {
    ...profile.manifest,
    id: "profile-b",
    name: "Profile B",
    description: "Second profile"
  },
  instructions: "# Profile B\n"
};

const profileC: ProfileDetail = {
  ...profile,
  id: "profile-c",
  manifest: {
    ...profile.manifest,
    id: "profile-c",
    name: "Profile C",
    description: "Third profile"
  },
  instructions: "# Profile C\n"
};

const richProfile: ProfileDetail = {
  ...profile,
  configText: `{
    "mcp": {
      "raw-search": { "type": "remote" },
      "raw-browser": { "type": "remote" }
    }
  }`,
  assetPolicy: {
    ownedDirs: [
      { kind: "skill", source: "skills/review", targetName: "profile-review" }
    ],
    ownedFiles: [
      { kind: "skill", source: "skills/debug.md", targetName: "profile-debug" }
    ],
    skillRefs: [
      { libraryId: "testing", targetName: "library-testing" },
      { libraryId: "docs", targetName: "library-docs" }
    ],
    mcpRefs: [
      { libraryId: "docs", targetName: "library-docs" },
      { libraryId: "shared", targetName: "shared-mcp" }
    ],
    disabledSkillPaths: ["legacy-skill"]
  }
};

const summaryOf = (detail: ProfileDetail) => ({
  id: detail.id,
  targetId: detail.manifest.targetId,
  name: detail.manifest.name,
  description: detail.manifest.description,
  contentHash: detail.contentHash,
  targetContentHashes: detail.targetContentHashes
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const managedState = (overrides: Partial<TargetManagementState> = {}): TargetManagementState => ({
  targetId: "opencode",
  activeProfileId: "daily-coding",
  activeProfileName: "Daily Coding",
  appliedProfileHash: "profile-hash",
  appliedLibraryVersions: { skills: {}, mcp: {} },
  status: "managed",
  lastAppliedAt: "2026-07-09T00:00:00.000Z",
  managedResourceCount: 3,
  warningCount: 0,
  errorCount: 0,
  ...overrides
});

const installApi = (overrides: Partial<AgentEnvApi> = {}) => {
  const api: AgentEnvApi = {
    onWindowCloseRequested: vi.fn().mockReturnValue(() => undefined),
    confirmWindowClose: vi.fn(),
    copyText: vi.fn().mockResolvedValue(undefined),
    selectSkillFolder: vi.fn().mockResolvedValue(undefined),
    listTargets: vi.fn().mockResolvedValue([target]),
    listTargetStates: vi.fn().mockResolvedValue([]),
    listSkillLibrary: vi.fn().mockResolvedValue([]),
    scanSkillInventory: vi.fn().mockResolvedValue([]),
    listSkillCleanupBackups: vi.fn().mockResolvedValue([]),
    ignoreSkillGroup: vi.fn().mockResolvedValue({
      id: "ignore-skill",
      scope: "group",
      skillKey: "skill",
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    }),
    unignoreSkillGroup: vi.fn().mockResolvedValue(undefined),
    listMcpLibrary: vi.fn().mockResolvedValue([]),
    saveMcpServer: vi.fn().mockImplementation(async (input) => input),
    removeMcpServer: vi.fn().mockResolvedValue(undefined),
    scanUnmanagedSkills: vi.fn().mockResolvedValue([]),
    importSkillToLibrary: vi.fn().mockResolvedValue({
      id: "skill",
      name: "skill",
      description: "",
      path: "/tmp/skill",
      sourceType: "local",
      source: "/tmp/skill",
      contentHash: "hash",
      updatedAt: "2026-07-02T00:00:00.000Z"
    }),
    importGitHubSkillToLibrary: vi.fn().mockResolvedValue({
      id: "github-reviewer",
      name: "GitHub Reviewer",
      description: "",
      path: "/tmp/skill",
      sourceType: "github",
      source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
      remoteRef: "main",
      remoteRevision: "revision",
      contentHash: "hash",
      updatedAt: "2026-07-02T00:00:00.000Z"
    }),
    removeSkillFromLibrary: vi.fn().mockResolvedValue({
      backupId: "remove-backup",
      libraryId: "skill",
      managedLocations: []
    }),
    checkSkillLibraryUpdates: vi.fn().mockResolvedValue([]),
    manageTargetSkill: vi.fn().mockResolvedValue(undefined),
    consolidateSkillGroup: vi.fn().mockResolvedValue({
      backupId: "cleanup-backup",
      libraryId: "skill",
      managedLocations: ["/tmp/skill"]
    }),
    rollbackSkillCleanup: vi.fn().mockResolvedValue(undefined),
    setSkillUpdateSource: vi.fn().mockImplementation(async (input) => ({
      id: input.id,
      name: input.id,
      description: "",
      path: "/tmp/skill",
      sourceType: input.sourceType,
      source: input.source,
      contentHash: "hash",
      updatedAt: "2026-07-02T00:00:00.000Z"
    })),
    previewLibrarySkillUpdate: vi.fn().mockResolvedValue({
      id: "skill",
      name: "skill",
      sourceType: "local",
      source: "/tmp/skill",
      currentRevision: "hash",
      latestRevision: "hash2",
      updateAvailable: true,
      changes: [],
      errors: []
    }),
    updateLibrarySkill: vi.fn().mockResolvedValue({
      id: "skill",
      name: "skill",
      description: "",
      path: "/tmp/skill",
      sourceType: "local",
      source: "/tmp/skill",
      contentHash: "hash",
      updatedAt: "2026-07-02T00:00:00.000Z"
    }),
    readSettings: vi.fn().mockResolvedValue({
      skillSyncMethod: "symlink",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60
    }),
    updateSettings: vi.fn().mockImplementation(async (input) => ({
      skillSyncMethod: input.skillSyncMethod ?? "symlink",
      skillStorageLocation: input.skillStorageLocation ?? "appData",
      skillAutoCheckEnabled: input.skillAutoCheckEnabled ?? true,
      skillAutoCheckIntervalMinutes: input.skillAutoCheckIntervalMinutes ?? 60
    })),
    readGitHubAuthStatus: vi.fn().mockResolvedValue({
      state: "configured",
      clientId: "client-123"
    }),
    startGitHubDeviceLogin: vi.fn().mockResolvedValue({
      id: "login-1",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresAt: "2026-07-08T00:15:00.000Z",
      intervalSeconds: 5
    }),
    pollGitHubDeviceLogin: vi.fn().mockResolvedValue({
      state: "signed-in",
      status: {
        state: "signed-in",
        clientId: "client-123",
        user: { login: "octocat" },
        rateLimit: {
          limit: 5000,
          remaining: 4999,
          resetAt: "2026-07-08T06:00:00.000Z"
        }
      }
    }),
    signOutGitHub: vi.fn().mockResolvedValue({
      state: "configured",
      clientId: "client-123"
    }),
    openGitHubDevicePage: vi.fn().mockResolvedValue(undefined),
    listProfiles: vi
      .fn()
      .mockResolvedValue([
        {
          id: "daily-coding",
          targetId: "opencode",
          name: "Daily Coding",
          description: "Default",
          contentHash: "profile-hash"
        }
      ]),
    readProfile: vi.fn().mockResolvedValue(profile),
    saveProfile: vi.fn().mockImplementation(async (input) => ({
      ...profile,
      ...input,
      id: input.manifest.id
    })),
    createProfile: vi.fn().mockImplementation(async (input) => ({
      ...profile,
      id: `${input.targetId}-created`,
      manifest: {
        ...profile.manifest,
        id: `${input.targetId}-created`,
        targetId: input.targetId,
        name: input.name ?? "New profile",
        description: input.description ?? ""
      }
    })),
    duplicateProfile: vi.fn().mockResolvedValue({
      ...profile,
      id: "daily-coding-copy",
      manifest: {
        ...profile.manifest,
        id: "daily-coding-copy",
        name: "Daily Coding Copy"
      }
    }),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    previewApply: vi.fn().mockResolvedValue(preview),
    applyProfile: vi.fn().mockResolvedValue({ ok: true, backupId: "backup-1" }),
    listBackups: vi.fn().mockResolvedValue([]),
    previewRollback: vi.fn().mockResolvedValue(rollbackPreview),
    rollback: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  };

  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: api
  });

  return api;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("App", () => {
  it("auto-dismisses successful feedback after five seconds but keeps errors visible", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <AppFeedback
        feedback={{ kind: "success", title: "Profile saved" }}
        onDismiss={onDismiss}
      />
    );

    expect(screen.queryByRole("button", { name: "Dismiss message" })).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(4999));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    onDismiss.mockClear();
    rerender(
      <AppFeedback
        feedback={{ kind: "error", title: "Action failed", message: "Try again" }}
        onDismiss={onDismiss}
      />
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  const openProfiles = async () => {
    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
  };

  it("renders the profile composer instead of tabs", async () => {
    const api = installApi();
    const { container } = render(<App />);

    await openProfiles();
    const brandIcon = container.querySelector<HTMLImageElement>(".brand-icon");
    expect(brandIcon).toBeInTheDocument();
    expect(brandIcon?.getAttribute("src")).toContain("app-icon");
    const composer = await screen.findByRole("region", { name: "Profile composer" });
    expect(within(composer).getByRole("heading", { name: "Profile Composer" })).toBeInTheDocument();
    expect(screen.getByText("Compose reusable environments and apply them safely to local agent targets.")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Safe apply" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "Review before apply"
    );
    expect(within(composer).getByRole("button", { name: "Skills" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(api.readProfile).toHaveBeenCalledWith("daily-coding");
    expect(screen.getByRole("button", { name: "Take over OpenCode" })).toBeInTheDocument();
    expect(screen.getByText("OpenCode source")).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "Instructions" })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "MCP Servers" })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "Advanced" })).toBeInTheDocument();
    for (const oldTab of ["Overview", "Instructions", "Config", "Resources", "Validation"]) {
      expect(screen.queryByRole("tab", { name: oldTab })).not.toBeInTheDocument();
    }

    fireEvent.click(within(composer).getByRole("button", { name: "Instructions" }));
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Agent\n");
    fireEvent.click(within(composer).getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("opencode.jsonc")).toHaveValue('{\n  "mcp": {}\n}\n');
  });

  it("opens libraries as an app-level workspace", async () => {
    installApi({
      listSkillLibrary: vi.fn().mockResolvedValue([
        {
          id: "github-reviewer",
          name: "GitHub Reviewer",
          description: "Review from GitHub",
          path: "/tmp/skills-library/github-reviewer",
          sourceType: "github",
          source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
          remoteRef: "main",
          remoteRevision: "revision-1",
          contentHash: "hash",
          updatedAt: "2026-07-02T00:00:00.000Z"
        }
      ]),
      checkSkillLibraryUpdates: vi.fn().mockResolvedValue([
        {
          id: "github-reviewer",
          name: "GitHub Reviewer",
          sourceType: "github",
          currentRevision: "revision-1",
          latestRevision: "revision-2",
          updateAvailable: true
        }
      ])
    });
    render(<App />);

    expect(await screen.findByRole("group", { name: "Library item github-reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Library/Skills" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Library item github-reviewer" })).toHaveTextContent("Update available");
    expect(screen.queryByRole("complementary", { name: "Library summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Activation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Profile sections" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 update available"));
  });

  it("offers GitHub connection recovery when an anonymous update check is rate limited", async () => {
    installApi({
      listSkillLibrary: vi.fn().mockResolvedValue([
        {
          id: "github-reviewer",
          name: "GitHub Reviewer",
          description: "Review from GitHub",
          path: "/tmp/skills-library/github-reviewer",
          sourceType: "github",
          source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
          contentHash: "hash",
          updatedAt: "2026-07-02T00:00:00.000Z"
        }
      ]),
      checkSkillLibraryUpdates: vi.fn().mockResolvedValue([
        {
          id: "github-reviewer",
          name: "GitHub Reviewer",
          sourceType: "github",
          currentRevision: "revision-1",
          updateAvailable: false,
          error: "GitHub API rate limit reached (403 Forbidden)"
        }
      ])
    });
    render(<App />);

    await screen.findByRole("group", { name: "Library item github-reviewer" });
    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("GitHub request limited");
    expect(alert).toHaveTextContent("Connect your account and try again");
    fireEvent.click(within(alert).getByRole("button", { name: "Connect GitHub" }));

    const githubSettings = await screen.findByRole("region", { name: "GitHub OAuth settings" });
    await waitFor(() => expect(document.activeElement).toBe(githubSettings));
    expect(screen.getByRole("button", { name: "Sign in with GitHub" })).toBeInTheDocument();
  });

  it("shows global feedback when checking one local library skill", async () => {
    const api = installApi({
      listSkillLibrary: vi.fn().mockResolvedValue([
        {
          id: "local-reviewer",
          name: "Local Reviewer",
          description: "Review from a local source",
          path: "/tmp/skills-library/local-reviewer",
          sourceType: "local",
          source: "/tmp/source/local-reviewer",
          contentHash: "hash",
          updatedAt: "2026-07-02T00:00:00.000Z"
        }
      ]),
      previewLibrarySkillUpdate: vi.fn().mockResolvedValue({
        id: "local-reviewer",
        name: "Local Reviewer",
        sourceType: "local",
        source: "/tmp/source/local-reviewer",
        currentRevision: "hash",
        latestRevision: "hash",
        updateAvailable: false,
        changes: [],
        errors: []
      })
    });
    render(<App />);

    expect(await screen.findByRole("group", { name: "Library item local-reviewer" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check update local-reviewer" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("local-reviewer is up to date")
    );
    expect(api.previewLibrarySkillUpdate).toHaveBeenCalledWith("local-reviewer");
  });

  it("rescans local target skills when opening local skill discoveries", async () => {
    const api = installApi({
      scanSkillInventory: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: "target-only-reviewer",
          name: "Target Only Reviewer",
          description: "Found on disk",
          path: "/tmp/opencode/skills/target-only-reviewer",
          foundIn: ["opencode"],
          status: "unmanaged"
        }
      ])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Scan local Skills" }));

    expect(await screen.findByRole("region", { name: "Environment skills" })).toBeInTheDocument();
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("group", { name: "Cleanup group target-only-reviewer" })
    ).toHaveTextContent("Found on disk");
  });

  it("checks skill updates on the configured background interval", async () => {
    let intervalCallback: (() => void) | undefined;
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation((callback, timeout) => {
      if (timeout === 5 * 60 * 1000) {
        intervalCallback = callback as () => void;
      }
      return 1 as unknown as ReturnType<typeof window.setInterval>;
    });
    const api = installApi({
      readSettings: vi.fn().mockResolvedValue({
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 5
      }),
      checkSkillLibraryUpdates: vi.fn().mockResolvedValue([])
    });
    render(<App />);

    await act(async () => {
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    });
    expect(api.checkSkillLibraryUpdates).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
    expect(intervalCallback).toBeDefined();

    await act(async () => {
      intervalCallback?.();
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    });
    expect(api.checkSkillLibraryUpdates).toHaveBeenCalledTimes(2);
  });

  it("starts and completes GitHub OAuth login from Settings", async () => {
    const api = installApi({
      readGitHubAuthStatus: vi
        .fn()
        .mockResolvedValueOnce({ state: "configured", clientId: "client-123" })
        .mockResolvedValueOnce({ state: "configured", clientId: "client-123" })
        .mockResolvedValue({
          state: "signed-in",
          clientId: "client-123",
          user: { login: "octocat" },
          rateLimit: {
            limit: 5000,
            remaining: 4999,
            resetAt: "2026-07-08T06:00:00.000Z"
          }
        })
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));

    expect(api.updateSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("ABCD-1234")).toBeInTheDocument());
    expect(api.openGitHubDevicePage).toHaveBeenCalledWith("https://github.com/login/device");
    fireEvent.click(screen.getByRole("button", { name: "Copy GitHub device code ABCD-1234" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith("ABCD-1234"));
    expect(screen.getByText("Copied")).toBeInTheDocument();

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(api.pollGitHubDeviceLogin).toHaveBeenCalledWith("login-1"));
    await waitFor(() => expect(screen.getByText("Connected as octocat")).toBeInTheDocument());
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("opens the MCP library and saves reusable MCP servers", async () => {
    const api = installApi({
      listMcpLibrary: vi.fn().mockResolvedValue([
        {
          id: "context7",
          name: "Context7",
          transport: "stdio",
          command: "npx",
          args: ["-y", "@upstash/context7-mcp"],
          env: {}
        }
      ])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    fireEvent.click(screen.getByRole("button", { name: "MCP Servers" }));

    expect(screen.getByRole("region", { name: "MCP library" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Library/MCP Servers" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Library summary" })).not.toBeInTheDocument();
    const context7Row = screen.getByRole("group", { name: "MCP library item context7" });
    expect(context7Row).toBeInTheDocument();

    fireEvent.click(within(context7Row).getByRole("button", { name: "Edit context7" }));
    expect(screen.getByLabelText("MCP library id")).toHaveValue("context7");
    expect(screen.getByLabelText("MCP library name")).toHaveValue("Context7");
    expect(screen.getByLabelText("MCP command")).toHaveValue("npx");
    expect(screen.getByLabelText("MCP args")).toHaveValue("-y\n@upstash/context7-mcp");

    fireEvent.change(screen.getByLabelText("MCP library id"), {
      target: { value: "shared-docs" }
    });
    fireEvent.change(screen.getByLabelText("MCP library name"), {
      target: { value: "Shared Docs" }
    });
    fireEvent.change(screen.getByLabelText("MCP transport"), {
      target: { value: "http" }
    });
    fireEvent.change(screen.getByLabelText("MCP URL"), {
      target: { value: "https://example.com/shared-docs/mcp" }
    });
    fireEvent.change(screen.getByLabelText("MCP env"), {
      target: { value: "DOCS_TOKEN\nCACHE_DIR=AGENTENV_CACHE_DIR" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save MCP server" }));

    await waitFor(() =>
      expect(api.saveMcpServer).toHaveBeenCalledWith({
        id: "shared-docs",
        name: "Shared Docs",
        transport: "http",
        command: undefined,
        url: "https://example.com/shared-docs/mcp",
        args: [],
        env: {
          CACHE_DIR: "AGENTENV_CACHE_DIR",
          DOCS_TOKEN: "DOCS_TOKEN"
        }
      })
    );

    fireEvent.click(within(context7Row).getByRole("button", { name: "Remove context7" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Delete MCP server" })).not.toBeInTheDocument();
    fireEvent.click(within(context7Row).getByRole("button", { name: "Remove context7" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete MCP server" });
    expect(deleteDialog).toHaveTextContent("Context7");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete server" }));
    await waitFor(() => expect(api.removeMcpServer).toHaveBeenCalledWith("context7"));
  });

  it("keeps an MCP draft open when persistence fails", async () => {
    installApi({
      saveMcpServer: vi.fn().mockRejectedValue(new Error("Library is read-only"))
    });
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    fireEvent.click(screen.getByRole("button", { name: "MCP Servers" }));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP server" }));
    fireEvent.change(screen.getByLabelText("MCP library id"), {
      target: { value: "local-search" }
    });
    fireEvent.change(screen.getByLabelText("MCP library name"), {
      target: { value: "Local Search" }
    });
    fireEvent.change(screen.getByLabelText("MCP command"), {
      target: { value: "node" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save MCP server" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("dialog", { name: "MCP server editor" })).toBeInTheDocument();
    expect(screen.getByLabelText("MCP library id")).toHaveValue("local-search");
    expect(screen.getByLabelText("MCP command")).toHaveValue("node");
  });

  it("refreshes target discovery from the Targets page", async () => {
    const refreshedTarget = {
      ...target,
      health: {
        ...target.health,
        status: "missing" as const,
        executableFound: false,
        executablePath: undefined,
        canWrite: true,
        summary: "opencode CLI not found"
      }
    };
    const api = installApi({
      listTargets: vi
        .fn()
        .mockResolvedValueOnce([target])
        .mockResolvedValue([refreshedTarget])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    fireEvent.click(screen.getByRole("button", { name: "Targets" }));
    expect(await screen.findByRole("article", { name: "Target OpenCode" })).toHaveTextContent("Ready");

    fireEvent.click(screen.getByRole("button", { name: "Refresh targets" }));

    await waitFor(() => expect(api.listTargets).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Target OpenCode" })).toHaveTextContent("Missing")
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Targets refreshed");
    expect(screen.queryByRole("button", { name: "Dismiss message" })).not.toBeInTheDocument();
  });

  it("opens at most one composer section and allows all sections to collapse", async () => {
    installApi({
      readProfile: vi.fn().mockResolvedValue(richProfile)
    });
    render(<App />);

    await openProfiles();
    const composer = await screen.findByRole("region", { name: "Profile composer" });
    const instructions = within(composer).getByRole("button", { name: "Instructions" });
    const skills = within(composer).getByRole("button", { name: "Skills" });
    const mcp = within(composer).getByRole("button", { name: "MCP Servers" });
    const advanced = within(composer).getByRole("button", { name: "Advanced" });

    expect(instructions).toHaveAccessibleDescription(/1.*AGENTS\.md/);
    expect(skills).toHaveAccessibleDescription(
      /4.*profile-review.*profile-debug.*library-testing.*\+1/
    );
    expect(mcp).toHaveAccessibleDescription(
      /4.*library-docs.*shared-mcp.*raw-search.*\+1/
    );
    expect(advanced).toHaveAccessibleDescription(/1.*legacy-skill/);
    expect(skills).toHaveAttribute("aria-expanded", "false");
    expect(instructions).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(mcp);
    expect(mcp).toHaveAttribute("aria-expanded", "true");
    expect(skills).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    expect(mcp).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("opencode.jsonc")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "History" })).toBeInTheDocument();

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("opencode.jsonc")).not.toBeInTheDocument();
  });

  it("shows rich profile row metadata", async () => {
    installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      readProfile: vi.fn().mockResolvedValue(richProfile),
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({
          lastAppliedAt: "2026-07-09T08:00:00.000Z",
          appliedLibraryVersions: {
            skills: { docs: "missing", testing: "missing" },
            mcp: { docs: "missing", shared: "missing" }
          }
        }),
        managedState({
          targetId: "codex",
          lastAppliedAt: "2026-07-10T08:00:00.000Z",
          appliedLibraryVersions: {
            skills: { docs: "missing", testing: "missing" },
            mcp: { docs: "missing", shared: "missing" }
          }
        })
      ])
    });
    render(<App />);

    await openProfiles();
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    const row = within(profileList).getByRole("button", { name: /Daily Coding/ });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row).toHaveTextContent("4 Skills");
    expect(row).toHaveTextContent("4 MCP");
    expect(row).toHaveTextContent("1 Instruction");
    expect(row).toHaveTextContent("Applied to Codex");
    expect(within(row).getByText("Jul 10")).toHaveAttribute(
      "datetime",
      "2026-07-10T08:00:00.000Z"
    );
    expect(row).not.toHaveTextContent("OpenCode");
    expect(document.querySelector(".profile-hero")).toHaveTextContent("Applied Jul 9");

    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Updated Agent\n" }
    });
    expect(row).toHaveTextContent("Unsaved");
  });

  it("moves the only New Profile action to the header", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    const newProfileButtons = screen.getAllByRole("button", { name: "New Profile" });
    expect(newProfileButtons).toHaveLength(1);
    expect(newProfileButtons[0].closest("header")).toHaveClass("profile-page-header");

    const edit = screen.getByRole("button", { name: "Edit profile" });
    const more = screen.getByRole("button", { name: "More profile actions" });
    const targetMenu = screen.getByRole("button", { name: "Select apply target" });
    expect(edit).toHaveAttribute("title", "Edit profile");
    expect(more).toHaveAttribute("title", "More profile actions");
    expect(targetMenu).toHaveAttribute("title", "Select apply target");
  });

  it("focuses Save when apply is invoked with unsaved changes", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Updated Agent\n" }
    });

    const saveButton = screen.getByRole("button", { name: "Save" });
    const applyButton = screen.getByRole("button", { name: "Save profile first" });
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);

    expect(api.previewApply).not.toHaveBeenCalled();
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "Save this profile before previewing changes"
    );
    expect(
      screen.getAllByText("Save this profile before previewing changes").length
    ).toBeGreaterThan(0);
    expect(saveButton).toHaveFocus();
  });

  it("prevents duplicate saves from the readiness remediation", async () => {
    const pendingSave = deferred<ProfileDetail>();
    const api = installApi({ saveProfile: vi.fn().mockReturnValue(pendingSave.promise) });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Pending save\n" }
    });

    const readiness = screen.getByRole("status", { name: "Profile readiness" });
    const saveNow = within(readiness).getByRole("button", { name: "Save now" });
    fireEvent.click(saveNow);
    fireEvent.click(saveNow);

    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(saveNow).toBeDisabled();

    pendingSave.resolve(profile);
    await waitFor(() => expect(saveNow).not.toBeInTheDocument());
  });

  it("prevents duplicate shortcut saves while persistence is pending", async () => {
    const pendingSave = deferred<ProfileDetail>();
    const api = installApi({ saveProfile: vi.fn().mockReturnValue(pendingSave.promise) });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Pending shortcut save\n" }
    });

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });
    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    pendingSave.resolve(profile);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });

  it("preserves a dirty Profile draft when shortcut save fails", async () => {
    const api = installApi({
      saveProfile: vi.fn().mockRejectedValue(new Error("Profile storage is read-only"))
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    const instructions = screen.getByLabelText("AGENTS.md");
    fireEvent.change(instructions, { target: { value: "# Shortcut draft\n" } });

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent("Profile storage is read-only");
    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(instructions).toHaveValue("# Shortcut draft\n");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("runs the whole-Profile save path from a clean shortcut", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.keyDown(document, { key: "s", ctrlKey: true });

    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1));
    expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({ manifest: expect.objectContaining({ id: "daily-coding" }) })
    );
  });

  it("keeps profiles available when selecting another apply target", async () => {
    const api = installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      listProfiles: vi.fn().mockResolvedValue([summaryOf(profile), summaryOf(codexProfile)]),
      readProfile: vi.fn().mockImplementation(async (profileId) =>
        profileId === codexProfile.id ? codexProfile : profile
      )
    });
    render(<App />);

    await openProfiles();
    let menuButton = screen.getByRole("button", { name: "Select apply target" });
    menuButton.focus();
    fireEvent.click(menuButton);
    let menu = screen.getByRole("menu", { name: "Apply targets" });
    const openCodeTarget = within(menu).getByRole("menuitemradio", { name: "OpenCode" });
    const codexTargetItem = within(menu).getByRole("menuitemradio", { name: "Codex" });
    expect(openCodeTarget).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(codexTargetItem).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(openCodeTarget.querySelector("img")).toHaveClass("profile-target-logo--opencode");
    expect(codexTargetItem.querySelector("img")).toHaveClass("profile-target-logo--codex");
    expect(screen.getByRole("button", { name: "Take over OpenCode" }).querySelector("img"))
      .toHaveClass("profile-target-logo--opencode");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Apply targets" })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();

    fireEvent.click(menuButton);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Apply targets" })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();

    fireEvent.click(menuButton);
    menu = screen.getByRole("menu", { name: "Apply targets" });
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Codex" }));
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    expect(within(profileList).getByText("Daily Coding")).toBeInTheDocument();
    const compatibleRow = within(profileList).getByRole("button", { name: /Codex Review/ });
    expect(screen.getByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take over Codex" })).toBeEnabled();

    fireEvent.click(compatibleRow);
    expect(await screen.findByRole("heading", { name: "Codex Review" })).toBeInTheDocument();
    expect(api.readProfile).toHaveBeenCalledWith("codex-review");
    menuButton = screen.getByRole("button", { name: "Select apply target" });
    fireEvent.click(menuButton);
    expect(
      within(screen.getByRole("menu", { name: "Apply targets" })).getByRole(
        "menuitemradio",
        { name: "Codex" }
      )
    ).toHaveAttribute("aria-checked", "true");
  });

  it("preserves a dirty draft when the checked target is re-selected", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    const instructions = screen.getByLabelText("AGENTS.md");
    fireEvent.change(instructions, { target: { value: "# Unsaved target-safe draft\n" } });

    const targetButton = screen.getByRole("button", { name: "Select apply target" });
    targetButton.focus();
    fireEvent.click(targetButton);
    const checkedTarget = screen.getByRole("menuitemradio", { name: "OpenCode" });
    expect(checkedTarget).toHaveAttribute("aria-checked", "true");
    fireEvent.click(checkedTarget);

    expect(screen.queryByRole("menu", { name: "Apply targets" })).not.toBeInTheDocument();
    expect(targetButton).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    expect(instructions).toHaveValue("# Unsaved target-safe draft\n");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(
      within(screen.getByRole("complementary", { name: "Profile list" })).getByRole("button", {
        name: /Daily Coding/
      })
    ).toHaveTextContent("Unsaved");
  });

  it("hides the previous editor while a different profile is loading", async () => {
    const profileBRead = deferred<ProfileDetail>();
    let deferProfileB = false;
    installApi({
      listProfiles: vi.fn().mockResolvedValue([summaryOf(profile), summaryOf(profileB)]),
      readProfile: vi.fn().mockImplementation(async (profileId) => {
        if (deferProfileB && profileId === profileB.id) return profileBRead.promise;
        return profileId === profileB.id ? profileB : profile;
      })
    });
    render(<App />);

    await openProfiles();
    await screen.findByRole("heading", { name: "Daily Coding" });
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Agent\n");

    deferProfileB = true;
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    fireEvent.click(within(profileList).getByRole("button", { name: /Profile B/ }));

    expect(screen.queryByRole("heading", { name: "Daily Coding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Profile composer" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("AGENTS.md")).not.toBeInTheDocument();

    await act(async () => {
      profileBRead.resolve(profileB);
      await profileBRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Profile B" })).toBeInTheDocument();
    const composer = screen.getByRole("region", { name: "Profile composer" });
    fireEvent.click(within(composer).getByRole("button", { name: "Instructions" }));
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Profile B\n");
  });

  it("ignores profile reads that resolve out of selection order", async () => {
    const profileBRead = deferred<ProfileDetail>();
    const profileCRead = deferred<ProfileDetail>();
    let deferSelectionReads = false;
    installApi({
      listProfiles: vi
        .fn()
        .mockResolvedValue([summaryOf(profile), summaryOf(profileB), summaryOf(profileC)]),
      readProfile: vi.fn().mockImplementation(async (profileId) => {
        if (deferSelectionReads && profileId === profileB.id) return profileBRead.promise;
        if (deferSelectionReads && profileId === profileC.id) return profileCRead.promise;
        return profileId === profileB.id ? profileB : profileId === profileC.id ? profileC : profile;
      })
    });
    render(<App />);

    await openProfiles();
    await screen.findByRole("heading", { name: "Daily Coding" });
    deferSelectionReads = true;
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    fireEvent.click(within(profileList).getByRole("button", { name: /Profile B/ }));
    fireEvent.click(within(profileList).getByRole("button", { name: /Profile C/ }));

    await act(async () => {
      profileCRead.resolve(profileC);
      await profileCRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Profile C" })).toBeInTheDocument();

    await act(async () => {
      profileBRead.resolve(profileB);
      await profileBRead.promise;
    });
    expect(screen.getByRole("heading", { name: "Profile C" })).toBeInTheDocument();
    expect(
      within(profileList).getByRole("button", { name: /Profile C/ })
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Profile C\n");
    expect(screen.getByRole("button", { name: "Take over OpenCode" })).toBeEnabled();
  });

  it("keeps busy state owned by the newest profile read", async () => {
    const profileBRead = deferred<ProfileDetail>();
    const profileCRead = deferred<ProfileDetail>();
    let deferSelectionReads = false;
    installApi({
      listProfiles: vi
        .fn()
        .mockResolvedValue([summaryOf(profile), summaryOf(profileB), summaryOf(profileC)]),
      readProfile: vi.fn().mockImplementation(async (profileId) => {
        if (deferSelectionReads && profileId === profileB.id) return profileBRead.promise;
        if (deferSelectionReads && profileId === profileC.id) return profileCRead.promise;
        return profileId === profileB.id ? profileB : profileId === profileC.id ? profileC : profile;
      })
    });
    render(<App />);

    await openProfiles();
    await screen.findByRole("heading", { name: "Daily Coding" });
    deferSelectionReads = true;
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    fireEvent.click(within(profileList).getByRole("button", { name: /Profile B/ }));
    fireEvent.click(within(profileList).getByRole("button", { name: /Profile C/ }));

    await act(async () => {
      profileBRead.resolve(profileB);
      await profileBRead.promise;
    });
    expect(screen.getByRole("button", { name: "Take over OpenCode" })).toBeDisabled();

    await act(async () => {
      profileCRead.resolve(profileC);
      await profileCRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Profile C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take over OpenCode" })).toBeEnabled();
  });

  it("ignores a stale preview after selecting another profile", async () => {
    const stalePreview = deferred<typeof preview>();
    const profileCRead = deferred<ProfileDetail>();
    let deferProfileC = false;
    const api = installApi({
      listProfiles: vi
        .fn()
        .mockResolvedValue([summaryOf(profileB), summaryOf(profileC)]),
      readProfile: vi.fn().mockImplementation(async (profileId) => {
        if (deferProfileC && profileId === profileC.id) return profileCRead.promise;
        return profileId === profileC.id ? profileC : profileB;
      }),
      previewApply: vi.fn().mockImplementation(() => stalePreview.promise)
    });
    render(<App />);

    await openProfiles();
    await screen.findByRole("heading", { name: "Profile B" });
    fireEvent.click(screen.getByRole("button", { name: "Take over OpenCode" }));
    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("profile-b", "opencode"));

    deferProfileC = true;
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    fireEvent.click(within(profileList).getByRole("button", { name: /Profile C/ }));
    await act(async () => {
      stalePreview.resolve({ ...preview, profileId: profileB.id });
      await stalePreview.promise;
    });

    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take over OpenCode" })).toBeDisabled();

    await act(async () => {
      profileCRead.resolve(profileC);
      await profileCRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Profile C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take over OpenCode" })).toBeEnabled();
  });

  it("keeps header menus exclusive and restores trigger focus", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    const targetButton = screen.getByRole("button", { name: "Select apply target" });
    const moreButton = screen.getByRole("button", { name: "More profile actions" });

    fireEvent.click(targetButton);
    expect(screen.getByRole("menu", { name: "Apply targets" })).toBeInTheDocument();
    fireEvent.click(moreButton);
    expect(screen.queryByRole("menu", { name: "Apply targets" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Profile actions" })).toBeInTheDocument();

    fireEvent.click(targetButton);
    expect(screen.queryByRole("menu", { name: "Profile actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Apply targets" })).toBeInTheDocument();

    fireEvent.click(moreButton);
    moreButton.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Profile actions" })).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();

    fireEvent.click(moreButton);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate profile" }));
    await waitFor(() => expect(api.duplicateProfile).toHaveBeenCalledWith("daily-coding"));
    expect(screen.queryByRole("menu", { name: "Profile actions" })).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();
  });

  it("shows lifecycle-aware readiness and apply actions", async () => {
    const unavailableTarget = {
      ...target,
      health: {
        ...target.health,
        status: "missing" as const,
        executableFound: false,
        executablePath: undefined,
        canWrite: false,
        summary: "opencode CLI not found"
      }
    };

    const readyApi = installApi();
    render(<App />);
    await openProfiles();
    let readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("OpenCode is ready to take over");
    expect(readiness).toHaveTextContent("Review before apply");
    expect(readiness).toHaveTextContent("Preview shows every replacement before a backup is created");
    let action = screen.getByRole("button", { name: "Take over OpenCode" });
    expect(action).toHaveAttribute("title", "Take over OpenCode");
    fireEvent.click(action);
    await waitFor(() => expect(readyApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    let dialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(dialog).getByRole("button", { name: "Apply profile" })).toBeEnabled();
    expect(readyApi.applyProfile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    cleanup();
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({ activeProfileId: "another-profile", managedResourceCount: 7 })
      ])
    });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("OpenCode is ready to preview and apply");
    expect(readiness).toHaveTextContent("Ready to review");
    action = screen.getByRole("button", { name: "Preview & apply to OpenCode" });
    expect(action).toHaveAttribute("title", "Preview & apply to OpenCode");

    cleanup();
    installApi({ listProfiles: vi.fn().mockResolvedValue([]) });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Create a profile to continue");
    expect(readiness).toHaveTextContent("Profile required");
    expect(readiness).not.toHaveTextContent("No action needed");
    expect(within(readiness).queryByRole("button", { name: "New Profile" })).not.toBeInTheDocument();
    action = screen.getByRole("button", { name: "Take over OpenCode" });
    expect(action).toBeDisabled();
    expect(action).toHaveAccessibleDescription("Select a profile before previewing changes");

    cleanup();
    installApi({ listTargets: vi.fn().mockResolvedValue([]) });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Select a target to continue");
    expect(within(readiness).getByRole("button", { name: "Open Targets" })).toBeInTheDocument();
    action = screen.getByRole("button", { name: "Apply profile" });
    expect(action).toBeDisabled();
    expect(action).toHaveAccessibleDescription("Select a target before previewing changes");

    cleanup();
    const unavailableApi = installApi({
      listTargets: vi.fn().mockResolvedValue([unavailableTarget])
    });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("OpenCode is unavailable");
    action = screen.getByRole("button", { name: "Review OpenCode issues" });
    expect(action).toHaveAttribute("title", "Review OpenCode issues");
    fireEvent.click(action);
    await waitFor(() => expect(unavailableApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    dialog = screen.getByRole("dialog", { name: "Preview" });
    expect(dialog).toHaveTextContent("opencode CLI not found");
    expect(within(dialog).getByRole("button", { name: "Apply profile" })).toBeDisabled();

    cleanup();
    const invalidProfile = {
      ...profile,
      instructions: "",
      manifest: {
        ...profile.manifest,
        managed: { ...profile.manifest.managed, config: false }
      }
    };
    const invalidApi = installApi({ readProfile: vi.fn().mockResolvedValue(invalidProfile) });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("This profile has validation issues");
    expect(within(readiness).getByRole("button", { name: "Review Advanced" })).toBeInTheDocument();
    action = screen.getByRole("button", { name: "Review OpenCode issues" });
    fireEvent.click(action);
    await waitFor(() => expect(invalidApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    dialog = screen.getByRole("dialog", { name: "Preview" });
    expect(dialog).toHaveTextContent("Instructions are empty");
    expect(within(dialog).getByRole("button", { name: "Apply profile" })).toBeDisabled();

    cleanup();
    const driftError =
      "External changes detected in AgentEnv-managed instructions instructions: /tmp/home/.config/opencode/AGENTS.md";
    const driftApi = installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({ activeProfileId: "another-profile" })
      ]),
      previewApply: vi.fn().mockResolvedValue({ ...preview, warnings: [], errors: [driftError] })
    });
    render(<App />);
    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Preview & apply to OpenCode" }));
    await waitFor(() => expect(driftApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    action = screen.getByRole("button", { name: "Resolve OpenCode drift" });
    expect(action).toHaveAttribute("title", "Resolve OpenCode drift");
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Preview found blocking issues");
    expect(within(readiness).getByRole("button", { name: "Review preview" })).toBeInTheDocument();
    dialog = screen.getByRole("dialog", { name: "Preview" });
    const driftConfirm = within(dialog).getByRole("button", { name: "Apply profile" });
    expect(driftConfirm).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Open recovery history" })).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByLabelText("I understand; back up and replace these changes")
    );
    const replaceButton = within(dialog).getByRole("button", { name: "Back up and replace" });
    expect(replaceButton).toBeEnabled();
    fireEvent.click(replaceButton);
    await waitFor(() =>
      expect(driftApi.applyProfile).toHaveBeenCalledWith("daily-coding", "preview-1", {
        allowManagedDrift: true
      })
    );
  });

  it("disables apply when the selected target already matches the profile", async () => {
    const api = installApi({
      listTargetStates: vi.fn().mockResolvedValue([managedState()])
    });
    render(<App />);

    await openProfiles();
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "OpenCode matches this profile"
    );
    const action = screen.getByRole("button", { name: "Applied to OpenCode" });
    expect(action).toBeDisabled();
    expect(action).toHaveTextContent("Applied");
    fireEvent.click(action);
    expect(api.previewApply).not.toHaveBeenCalled();
  });

  it("prevents removing a profile that is active on a target", async () => {
    const api = installApi({
      listTargetStates: vi.fn().mockResolvedValue([managedState()])
    });
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    const deleteDialog = screen.getByRole("dialog", { name: "Delete profile" });
    expect(deleteDialog).toHaveTextContent("Apply another profile before removing it");
    expect(within(deleteDialog).queryByRole("button", { name: "Remove profile" })).toBeNull();
    expect(api.deleteProfile).not.toHaveBeenCalled();
  });

  it("shows target management status on the Targets page", async () => {
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        {
          targetId: "opencode",
          activeProfileId: "daily-coding",
          activeProfileName: "Daily Coding",
          status: "managed",
          lastAppliedAt: "2026-07-09T00:00:00.000Z",
          managedResourceCount: 3,
          warningCount: 0,
          errorCount: 0
        }
      ])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Targets" }));

    const openCodeCard = await screen.findByRole("article", { name: "Target OpenCode" });
    expect(within(openCodeCard).getByText("Managed by AgentEnv")).toBeInTheDocument();
    expect(within(openCodeCard).getByText("Active profile")).toBeInTheDocument();
    expect(within(openCodeCard).getByText("Daily Coding")).toBeInTheDocument();
  });

  it("creates, edits, duplicates, and deletes profiles from the profile workspace", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit profile" });
    fireEvent.change(within(editDialog).getByLabelText("Profile name"), {
      target: { value: "Review Focus" }
    });
    fireEvent.change(within(editDialog).getByLabelText("Description"), {
      target: { value: "Review and quality checks" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Done" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(api.saveProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          manifest: expect.objectContaining({
            id: "daily-coding",
            name: "Review Focus",
            description: "Review and quality checks"
          })
        })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate profile" }));
    await waitFor(() => expect(api.duplicateProfile).toHaveBeenCalledWith("daily-coding"));

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    const createDialog = screen.getByRole("dialog", { name: "New profile" });
    fireEvent.change(within(createDialog).getByLabelText("Profile name"), {
      target: { value: "Docs Writing" }
    });
    fireEvent.change(within(createDialog).getByLabelText("Description"), {
      target: { value: "Writing setup" }
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.createProfile).toHaveBeenCalledWith({
        targetId: "opencode",
        name: "Docs Writing",
        description: "Writing setup"
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete profile" });
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Remove profile" }));

    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("opencode-created"));
  });

  it("guards dirty profile drafts before context-changing actions", async () => {
    installApi();
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByRole("textbox", { name: "AGENTS.md" }), {
      target: { value: "# Unsaved guard\n" }
    });
    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));

    const guard = screen.getByRole("dialog", { name: "Unsaved profile changes" });
    expect(guard).toHaveTextContent("create a new profile");
    fireEvent.click(within(guard).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("textbox", { name: "AGENTS.md" })).toHaveValue(
      "# Unsaved guard\n"
    );

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved profile changes" })).getByRole(
        "button",
        { name: "Discard changes" }
      )
    );
    expect(await screen.findByRole("dialog", { name: "New profile" })).toBeInTheDocument();
  });

  it("preserves a dirty draft when save-and-continue fails", async () => {
    installApi({ saveProfile: vi.fn().mockRejectedValue(new Error("Save failed")) });
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByRole("textbox", { name: "AGENTS.md" }), {
      target: { value: "# Keep this draft\n" }
    });
    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved profile changes" })).getByRole(
        "button",
        { name: "Save and continue" }
      )
    );

    await screen.findByRole("alert");
    expect(screen.getByRole("dialog", { name: "Unsaved profile changes" })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved profile changes" })).getByRole(
        "button",
        { name: "Cancel" }
      )
    );
    expect(screen.getByRole("textbox", { name: "AGENTS.md" })).toHaveValue(
      "# Keep this draft\n"
    );
  });

  it("uses the profile dirty guard when the Electron window requests close", async () => {
    let requestClose = () => undefined;
    const api = installApi({
      onWindowCloseRequested: vi.fn().mockImplementation((callback) => {
        requestClose = callback;
        return () => undefined;
      })
    });
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByRole("textbox", { name: "AGENTS.md" }), {
      target: { value: "# Unsaved before close\n" }
    });
    act(() => requestClose());

    const guard = await screen.findByRole("dialog", { name: "Unsaved profile changes" });
    expect(guard).toHaveTextContent("close AgentEnv Manager");
    fireEvent.click(within(guard).getByRole("button", { name: "Discard changes" }));
    expect(api.confirmWindowClose).toHaveBeenCalledOnce();
  });

  it("previews and restores a backup from history", async () => {
    const api = installApi({
      listBackups: vi.fn().mockResolvedValue([backup])
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const history = await screen.findByRole("region", { name: "History" });
    const previewRollbackButton = within(history).getByRole("button", {
      name: "Preview restore Daily Coding"
    });
    previewRollbackButton.focus();
    fireEvent.click(previewRollbackButton);

    await waitFor(() => expect(api.previewRollback).toHaveBeenCalledWith(backup.id));
    const rollbackDialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(rollbackDialog).getByText("Rollback preview")).toBeInTheDocument();
    expect(screen.getAllByText("/tmp/home/.config/opencode/AGENTS.md").length).toBeGreaterThan(0);

    expect(within(history).queryByRole("button", { name: "Restore backup" })).not.toBeInTheDocument();
    fireEvent.click(within(rollbackDialog).getByRole("button", { name: "Restore backup" }));

    await waitFor(() => expect(api.rollback).toHaveBeenCalledWith(backup.id));
    expect(screen.queryByText("Rollback preview")).not.toBeInTheDocument();
    await waitFor(() => expect(previewRollbackButton).toHaveFocus());
  });

  it("uses the confirmation preview when recovery starts from Targets", async () => {
    const api = installApi({
      listBackups: vi.fn().mockResolvedValue([backup])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    fireEvent.click(screen.getByRole("button", { name: "Targets" }));
    const history = await screen.findByRole("region", { name: "History" });
    fireEvent.click(
      within(history).getByRole("button", { name: "Preview restore Daily Coding" })
    );

    await waitFor(() => expect(api.previewRollback).toHaveBeenCalledWith(backup.id));
    const rollbackDialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(rollbackDialog).getByText("Rollback preview")).toBeInTheDocument();
    expect(within(history).queryByRole("button", { name: "Restore backup" })).not.toBeInTheDocument();
    fireEvent.click(within(rollbackDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("keeps rollback failures visible inside the confirmation dialog", async () => {
    const api = installApi({
      listBackups: vi.fn().mockResolvedValue([backup]),
      rollback: vi.fn().mockResolvedValue({ ok: false, errors: ["Restore failed"] })
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const history = await screen.findByRole("region", { name: "History" });
    fireEvent.click(
      within(history).getByRole("button", { name: "Preview restore Daily Coding" })
    );

    const rollbackDialog = await screen.findByRole("dialog", { name: "Preview" });
    fireEvent.click(within(rollbackDialog).getByRole("button", { name: "Restore backup" }));

    await waitFor(() => expect(api.rollback).toHaveBeenCalledWith(backup.id));
    expect(within(rollbackDialog).getByText("Restore failed")).toBeInTheDocument();
    expect(rollbackDialog).toBeInTheDocument();
  });

  it("prevents dismissing rollback confirmation while restore is running", async () => {
    const pendingRollback = deferred<{ ok: true }>();
    const api = installApi({
      listBackups: vi.fn().mockResolvedValue([backup]),
      rollback: vi.fn().mockReturnValue(pendingRollback.promise)
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const history = await screen.findByRole("region", { name: "History" });
    fireEvent.click(
      within(history).getByRole("button", { name: "Preview restore Daily Coding" })
    );

    const rollbackDialog = await screen.findByRole("dialog", { name: "Preview" });
    fireEvent.click(within(rollbackDialog).getByRole("button", { name: "Restore backup" }));
    await waitFor(() => expect(api.rollback).toHaveBeenCalledWith(backup.id));

    const cancel = within(rollbackDialog).getByRole("button", { name: "Cancel" });
    expect(cancel).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(rollbackDialog.parentElement!);
    expect(rollbackDialog).toBeInTheDocument();

    pendingRollback.resolve({ ok: true });
    await waitFor(() => expect(rollbackDialog).not.toBeInTheDocument());
  });
});
