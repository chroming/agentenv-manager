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
  AgentEnvSettings,
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
  iconKey: "opencode",
  displayOrder: 0,
  instructionsLabel: "AGENTS.md",
  configLabel: "opencode.jsonc",
  configLanguage: "jsonc",
  mcpConfigKey: "mcp",
  realWritesEnabled: true,
  executableName: "opencode",
  capabilities: {
    instructions: true,
    skills: true,
    mcpTransports: ["stdio", "http", "sse"],
    agentFormat: "opencode",
    disabledSkillPaths: false
  },
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
    installationFound: true,
    installationEvidence: [
      { kind: "command", label: "opencode command", path: "/usr/local/bin/opencode" }
    ],
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
  iconKey: "codex",
  displayOrder: 1,
  instructionsLabel: "AGENTS.md",
  configLabel: "config.toml",
  configLanguage: "toml",
  mcpConfigKey: "mcp_servers",
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
  createdAt: detail.manifest.createdAt,
  iconKey: detail.manifest.iconKey,
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
  lifecycleStatus: "applied",
  lastAppliedAt: "2026-07-09T00:00:00.000Z",
  managedResourceCount: 3,
  warningCount: 0,
  errorCount: 0,
  ...overrides
});

const installApi = (overrides: Partial<AgentEnvApi> = {}) => {
  const api: AgentEnvApi = {
    platform: "darwin",
    onWindowCloseRequested: vi.fn().mockReturnValue(() => undefined),
    setWindowCloseGuard: vi.fn(),
    confirmWindowClose: vi.fn(),
    cancelWindowClose: vi.fn(),
    copyText: vi.fn().mockResolvedValue(undefined),
    selectSkillFolder: vi.fn().mockResolvedValue(undefined),
    listSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
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
    previewSkillImport: vi.fn().mockImplementation(async (source) => ({
      source,
      incoming: {
        id: "skill",
        name: "skill",
        description: "",
        contentHash: "hash",
        source: "/tmp/skill",
        skillMarkdown: "# Skill\n"
      },
      conflicts: [],
      suggestedId: "skill"
    })),
    previewSkillMerge: vi.fn().mockResolvedValue({
      name: "skill",
      entries: [],
      comparisons: [],
      profileCount: 0,
      installCount: 0
    }),
    mergeLibrarySkills: vi.fn().mockResolvedValue({
      backupId: "merge-backup",
      skill: {
        id: "skill",
        name: "skill",
        description: "",
        path: "/tmp/skill",
        sourceType: "local",
        source: "/tmp/skill",
        updatePolicy: "untracked",
        contentHash: "hash",
        updatedAt: "2026-07-02T00:00:00.000Z"
      },
      removedIds: [],
      profilesUpdated: 0,
      installsUpdated: 0
    }),
    importSkillToLibrary: vi.fn().mockResolvedValue({
      skill: {
        id: "skill",
        name: "skill",
        description: "",
        path: "/tmp/skill",
        sourceType: "local",
        source: "/tmp/skill",
        updatePolicy: "untracked",
        contentHash: "hash",
        updatedAt: "2026-07-02T00:00:00.000Z"
      },
      managedLocations: []
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
    scanGitHubSkills: vi.fn().mockResolvedValue({
      owner: "acme",
      repo: "skills",
      ref: "main",
      rootPath: "",
      truncated: false,
      candidates: []
    }),
    importGitHubSkills: vi.fn().mockResolvedValue({ imported: [], failed: [] }),
    scanRepositorySkills: vi.fn().mockResolvedValue({
      repository: "git@example.test:team/skills.git",
      ref: "main",
      directory: "",
      transport: "system-git",
      truncated: false,
      candidates: []
    }),
    importRepositorySkillToLibrary: vi.fn().mockResolvedValue({
      id: "repository-reviewer",
      name: "Repository Reviewer",
      description: "",
      path: "/tmp/repository-reviewer",
      sourceType: "git",
      source: "git@example.test:team/skills.git",
      updatePolicy: "tracked",
      contentHash: "hash",
      updatedAt: "2026-07-17T00:00:00.000Z"
    }),
    importRepositorySkills: vi.fn().mockResolvedValue({ imported: [], failed: [] }),
    cancelRepositoryOperations: vi.fn().mockResolvedValue(undefined),
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
    setSharedSkillRetention: vi.fn().mockResolvedValue(undefined),
    retireSharedSkill: vi.fn().mockResolvedValue({
      backupId: "retire-backup",
      libraryId: "skill",
      managedLocations: ["/tmp/shared/skill"],
      operation: "retire"
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
    setSkillUpdatePolicy: vi.fn().mockImplementation(async (input) => ({
      id: input.id,
      name: input.id,
      description: "",
      path: "/tmp/skill",
      sourceType: "local",
      source: "/tmp/skill",
      updatePolicy: input.policy,
      contentHash: "hash",
      updatedAt: "2026-07-02T00:00:00.000Z"
    })),
    setSkillAvailability: vi.fn().mockImplementation(async (input) => ({
      id: input.id,
      name: input.id,
      description: "",
      path: "/tmp/skill",
      sourceType: "local",
      globallyEnabled: input.enabled,
      updatePolicy: "untracked",
      contentHash: "hash",
      updatedAt: "2026-07-02T00:00:00.000Z"
    })),
    setSkillIcon: vi.fn().mockImplementation(async (input) => ({
      id: input.id,
      name: input.id,
      description: "",
      iconKey: input.iconKey,
      path: "/tmp/skill",
      sourceType: "local",
      updatePolicy: "untracked",
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
      locale: "system",
      skillSyncMethod: "symlink",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null
    }),
    updateSettings: vi.fn().mockImplementation(async (input) => ({
      locale: input.locale ?? "system",
      skillSyncMethod: input.skillSyncMethod ?? "symlink",
      skillStorageLocation: input.skillStorageLocation ?? "appData",
      skillAutoCheckEnabled: input.skillAutoCheckEnabled ?? true,
      skillAutoCheckIntervalMinutes: input.skillAutoCheckIntervalMinutes ?? 60,
      backupRetentionDays: input.backupRetentionDays ?? null,
      enabledTargetIds: input.enabledTargetIds
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
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
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
    updateProfileMetadata: vi.fn().mockImplementation(async (input) => ({
      ...profile,
      manifest: {
        ...profile.manifest,
        name: input.name ?? profile.manifest.name,
        description: input.description ?? profile.manifest.description,
        iconKey: input.iconKey ?? profile.manifest.iconKey
      }
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
    previewCreateProfileFromTarget: vi.fn().mockRejectedValue(new Error("not configured")),
    createProfileFromTarget: vi.fn().mockRejectedValue(new Error("not configured")),
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
    listManagedBackups: vi.fn().mockResolvedValue({
      items: [],
      totalBytes: 0,
      eligibleBytes: 0,
      eligibleCount: 0,
      retentionDays: null
    }),
    deleteManagedBackup: vi.fn().mockResolvedValue({ deletedCount: 1, freedBytes: 0 }),
    cleanupManagedBackups: vi.fn().mockResolvedValue({
      deletedCount: 0,
      freedBytes: 0,
      failures: []
    }),
    previewRollback: vi.fn().mockResolvedValue(rollbackPreview),
    rollback: vi.fn().mockResolvedValue({ ok: true }),
    previewStopManaging: vi.fn().mockResolvedValue({
      ...rollbackPreview,
      id: "stop-managing-1",
      backupId: "",
      targetId: "opencode",
      targetName: "OpenCode",
      mode: "keep-current",
      managedResourceCount: 3,
      stateFingerprint: "state-hash"
    }),
    stopManaging: vi.fn().mockResolvedValue({ ok: true, backupId: "backup-1" }),
    createDataBackup: vi.fn().mockResolvedValue(undefined),
    openDataFolder: vi.fn().mockResolvedValue(undefined),
    selectDataRestore: vi.fn().mockResolvedValue(undefined),
    restoreDataBackup: vi.fn().mockResolvedValue({ safetyBackupPath: "/tmp/safety" }),
    adoptTargetChanges: vi.fn().mockResolvedValue({
      profile,
      adopted: ["instructions"],
      skipped: []
    }),
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
    expect(within(composer).queryByRole("heading", { name: "Profile Composer" })).not.toBeInTheDocument();
    expect(screen.getByText("Compose reusable environments and apply them safely to local Agents.")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Safe apply" })).not.toBeInTheDocument();
    expect(document.querySelector(".profile-readiness-strip")).toBeNull();
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "Ready to take over OpenCode"
    );
    expect(within(composer).getByRole("button", { name: "Skills" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(api.readProfile).toHaveBeenCalledWith("daily-coding");
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.getByText("Native: OpenCode")).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "Instructions" })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "MCPs" })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "Advanced" })).toBeInTheDocument();
    for (const oldTab of ["Overview", "Instructions", "Config", "Resources", "Validation"]) {
      expect(screen.queryByRole("tab", { name: oldTab })).not.toBeInTheDocument();
    }

    fireEvent.click(within(composer).getByRole("button", { name: "Instructions" }));
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Agent\n");
    fireEvent.click(within(composer).getByRole("button", { name: "Advanced" }));
    expect(screen.getByLabelText("OpenCode settings (opencode.jsonc)")).toHaveValue(
      '{\n  "mcp": {}\n}\n'
    );
  });

  it("renders Library Skills before startup discovery and update checks finish", async () => {
    const targetRequest = deferred<TargetInfo[]>();
    const inventoryRequest = deferred<Awaited<ReturnType<AgentEnvApi["scanSkillInventory"]>>>();
    const updateRequest = deferred<Awaited<ReturnType<AgentEnvApi["checkSkillLibraryUpdates"]>>>();
    const api = installApi({
      listTargets: vi.fn().mockReturnValue(targetRequest.promise),
      listSkillLibrary: vi.fn().mockResolvedValue([
        {
          id: "startup-reviewer",
          name: "Startup Reviewer",
          description: "Available from local Library data",
          path: "/tmp/skills-library/startup-reviewer",
          sourceType: "github",
          source: "https://github.com/acme/skills/tree/main/startup-reviewer",
          updatePolicy: "tracked",
          contentHash: "startup-hash",
          updatedAt: "2026-07-15T00:00:00.000Z"
        }
      ]),
      scanSkillInventory: vi.fn().mockReturnValue(inventoryRequest.promise),
      checkSkillLibraryUpdates: vi.fn().mockReturnValue(updateRequest.promise)
    });
    render(<App />);

    expect(
      await screen.findByRole("group", { name: "Library item startup-reviewer" })
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading skills")).not.toBeInTheDocument();
    expect(api.scanSkillInventory).not.toHaveBeenCalled();
    expect(api.checkSkillLibraryUpdates).not.toHaveBeenCalled();

    await act(async () => {
      targetRequest.resolve([target]);
      await Promise.resolve();
    });
    await waitFor(() => expect(api.scanSkillInventory).toHaveBeenCalledTimes(1));
    expect(api.checkSkillLibraryUpdates).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Skill library" })).toHaveTextContent(
      "Startup Reviewer"
    );
    expect(screen.getByRole("region", { name: "System status" })).not.toHaveTextContent(
      "Loading"
    );

    await act(async () => {
      inventoryRequest.resolve([]);
      updateRequest.resolve([]);
      await Promise.resolve();
    });
  });

  it("opens libraries as an app-level workspace", async () => {
    const listSkillLibrary = vi.fn().mockResolvedValue([
      {
        id: "github-reviewer",
        name: "GitHub Reviewer",
        description: "Review from GitHub",
        path: "/tmp/skills-library/github-reviewer",
        sourceType: "github",
        source: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
        updatePolicy: "tracked",
        remoteRef: "main",
        remoteRevision: "revision-1",
        contentHash: "hash",
        updatedAt: "2026-07-02T00:00:00.000Z"
      }
    ]);
    const checkSkillLibraryUpdates = vi.fn().mockResolvedValue([
      {
        id: "github-reviewer",
        name: "GitHub Reviewer",
        sourceType: "github",
        currentRevision: "revision-1",
        latestRevision: "revision-2",
        updateAvailable: true
      }
    ]);
    installApi({
      listSkillLibrary,
      checkSkillLibraryUpdates
    });
    render(<App />);

    expect(await screen.findByRole("group", { name: "Library item github-reviewer" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Skill library" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Library item github-reviewer" }))
        .getByRole("button", { name: "Review update github-reviewer" })
    ).toHaveTextContent("Update");
    expect(screen.queryByRole("complementary", { name: "Library summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Activation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Profile sections" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 update available"));

    fireEvent.click(screen.getByRole("button", { name: "Refresh skills" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Skills refreshed"));
    expect(listSkillLibrary).toHaveBeenCalledTimes(3);
    expect(checkSkillLibraryUpdates).toHaveBeenCalledTimes(2);
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
          updatePolicy: "tracked",
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
          updatePolicy: "tracked",
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

    const localRow = await screen.findByRole("group", { name: "Library item local-reviewer" });
    expect(within(localRow).queryByRole("button", { name: "Check update local-reviewer" })).toBeNull();
    fireEvent.click(within(localRow).getByRole("button", { name: "More actions for local-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Check update/ }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("local-reviewer source is current")
    );
    expect(screen.queryByRole("dialog", { name: "Update preview for local-reviewer" })).toBeNull();
    expect(api.previewLibrarySkillUpdate).toHaveBeenCalledWith("local-reviewer");
  });

  it("updates Skill metadata locally without reloading Profiles or Target inventory", async () => {
    const api = installApi({
      listSkillLibrary: vi.fn().mockResolvedValue([
        {
          id: "local-reviewer",
          name: "Local Reviewer",
          description: "Review from a local source",
          path: "/tmp/skills-library/local-reviewer",
          sourceType: "local",
          source: "/tmp/source/local-reviewer",
          updatePolicy: "tracked",
          contentHash: "hash",
          updatedAt: "2026-07-02T00:00:00.000Z"
        }
      ])
    });
    render(<App />);

    const localRow = await screen.findByRole("group", { name: "Library item local-reviewer" });
    const unrelatedReads = [
      api.listTargets,
      api.listTargetStates,
      api.listProfiles,
      api.listBackups,
      api.listSkillLibrary,
      api.scanSkillInventory,
      api.listMcpLibrary
    ];
    unrelatedReads.forEach((read) => vi.mocked(read).mockClear());
    vi.mocked(api.checkSkillLibraryUpdates).mockClear();

    fireEvent.click(within(localRow).getByRole("button", { name: "More actions for local-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
    const trackingSwitch = screen.getByRole("switch", {
      name: "Track updates for local-reviewer"
    });
    fireEvent.click(trackingSwitch);
    await waitFor(() =>
      expect(api.setSkillUpdatePolicy).toHaveBeenCalledWith({
        id: "local-reviewer",
        policy: "untracked"
      })
    );
    await waitFor(() => expect(trackingSwitch).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(trackingSwitch);
    await waitFor(() =>
      expect(api.setSkillUpdatePolicy).toHaveBeenCalledWith({
        id: "local-reviewer",
        policy: "tracked"
      })
    );
    await waitFor(() =>
      expect(api.checkSkillLibraryUpdates).toHaveBeenCalledWith(["local-reviewer"])
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Change icon for local-reviewer" })
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Code" }));
    await waitFor(() =>
      expect(api.setSkillIcon).toHaveBeenCalledWith({ id: "local-reviewer", iconKey: "code" })
    );
    unrelatedReads.forEach((read) => expect(read).not.toHaveBeenCalled());
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
      ]).mockResolvedValueOnce([
        {
          id: "refreshed-reviewer",
          name: "Refreshed Reviewer",
          description: "Found after rescanning",
          path: "/tmp/opencode/skills/refreshed-reviewer",
          foundIn: ["opencode"],
          status: "unmanaged"
        }
      ])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Scan local" }));

    expect(await screen.findByRole("region", { name: "Environment skills" })).toBeInTheDocument();
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("group", { name: "Cleanup group target-only-reviewer" })
    ).toHaveTextContent("Found on disk");

    fireEvent.click(screen.getByRole("button", { name: "Refresh local skills" }));
    expect(
      await screen.findByRole("group", { name: "Cleanup group refreshed-reviewer" })
    ).toHaveTextContent("Found after rescanning");
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent("Local skills refreshed");
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
        locale: "system",
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

  it("presents Live link as the default recommended Skill deployment mode", async () => {
    installApi();
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const syncMethod = screen.getByLabelText("Global skill sync method");
    expect(syncMethod).toHaveValue("symlink");
    expect(
      within(syncMethod).getByRole("option", { name: "Live link (recommended)" })
    ).toBeInTheDocument();
  });

  it("switches and persists the interface language from Settings", async () => {
    const api = installApi();
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const unrelatedReads = [
      api.listTargets,
      api.listTargetStates,
      api.listProfiles,
      api.listBackups,
      api.listSkillLibrary,
      api.scanSkillInventory,
      api.listMcpLibrary
    ];
    unrelatedReads.forEach((read) => vi.mocked(read).mockClear());

    const languageSelect = screen.getByTestId("locale-select");
    fireEvent.change(languageSelect, { target: { value: "zh_CN" } });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ locale: "zh_CN" }));
    unrelatedReads.forEach((read) => expect(read).not.toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "配置方案" })).toBeInTheDocument();
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-CN"));

    fireEvent.change(screen.getByTestId("locale-select"), { target: { value: "zh_TW" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "設定檔" })).toBeInTheDocument());
    await waitFor(() => expect(document.documentElement.lang).toBe("zh-TW"));

    fireEvent.change(screen.getByTestId("locale-select"), { target: { value: "en" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Profiles" })).toBeInTheDocument());
    await waitFor(() => expect(document.documentElement.lang).toBe("en-US"));
  });

  it("turns Agents off and removes their operational UI", async () => {
    let enabledTargetIds = ["opencode", "codex"];
    const allTargets = [target, codexTarget];
    const listTargets = vi.fn(async () =>
      allTargets.filter((item) => enabledTargetIds.includes(item.id))
    );
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      enabledTargetIds = input.enabledTargetIds ?? enabledTargetIds;
      return {
        locale: "system" as const,
        skillSyncMethod: "symlink" as const,
        skillStorageLocation: "appData" as const,
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds
      };
    });
    const api = installApi({
      listSupportedTargets: vi.fn().mockResolvedValue(allTargets),
      listTargets,
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds
      }),
      updateSettings
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Turn off Codex" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ enabledTargetIds: ["opencode"] })
    );
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Turn on Codex" })).toHaveAttribute(
        "aria-checked",
        "false"
      )
    );
    expect(listTargets).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("switch", { name: "Turn off OpenCode" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenLastCalledWith({ enabledTargetIds: [] })
    );
    expect(screen.queryByRole("button", { name: "Agents" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
    await screen.findByRole("region", { name: "Profiles" });
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(api.listSupportedTargets).toHaveBeenCalled();
  });

  it("confirms before turning off a managed Agent", async () => {
    let enabledTargetIds = ["opencode"];
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      enabledTargetIds = input.enabledTargetIds ?? enabledTargetIds;
      return {
        locale: "system" as const,
        skillSyncMethod: "symlink" as const,
        skillStorageLocation: "appData" as const,
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds
      };
    });
    const api = installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target]),
      listTargets: vi.fn(async () => enabledTargetIds.length > 0 ? [target] : []),
      listTargetStates: vi.fn().mockResolvedValue([managedState()]),
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds
      }),
      updateSettings
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Turn off OpenCode" }));

    const dialog = screen.getByRole("dialog", { name: "Turn off OpenCode?" });
    expect(dialog).toHaveTextContent("This does not stop management");
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off OpenCode" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ enabledTargetIds: [] }));
  });

  it("keeps an Agent enabled while recovery is required", async () => {
    const updateSettings = vi.fn();
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target]),
      listTargets: vi.fn().mockResolvedValue([target]),
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({ lifecycleStatus: "recovery-required" })
      ]),
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds: ["opencode"]
      }),
      updateSettings
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByText("Recovery required")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Turn off OpenCode" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open Recovery" }));
    expect(await screen.findByRole("region", { name: "Agents" })).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: "MCPs" }));

    expect(screen.getByRole("region", { name: "MCP library" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MCPs" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Library summary" })).not.toBeInTheDocument();
    const context7Row = screen.getByRole("group", { name: "MCP library item context7" });
    expect(context7Row).toBeInTheDocument();

    fireEvent.click(within(context7Row).getByRole("button", { name: "More actions for context7" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit context7" }));
    expect(screen.getByLabelText("MCP library id")).toHaveValue("context7");
    expect(screen.getByLabelText("MCP library name")).toHaveValue("Context7");
    expect(screen.getByLabelText("MCP command")).toHaveValue("npx");
    expect(screen.getByLabelText("MCP args")).toHaveValue("-y\n@upstash/context7-mcp");
    expect(screen.getByLabelText("MCP library id")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("MCP library name"), {
      target: { value: "Shared Docs" }
    });
    fireEvent.change(screen.getByLabelText("MCP transport"), {
      target: { value: "http" }
    });
    fireEvent.change(screen.getByLabelText("MCP URL"), {
      target: { value: "https://example.com/shared-docs/mcp" }
    });
    expect(screen.queryByLabelText("MCP env")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.saveMcpServer).toHaveBeenCalledWith({
        existingId: "context7",
        id: "context7",
        name: "Shared Docs",
        transport: "http",
        command: undefined,
        url: "https://example.com/shared-docs/mcp",
        args: [],
        env: {}
      })
    );

    fireEvent.click(within(context7Row).getByRole("button", { name: "More actions for context7" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove context7" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Delete MCP" })).not.toBeInTheDocument();
    fireEvent.click(within(context7Row).getByRole("button", { name: "More actions for context7" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove context7" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete MCP" });
    expect(deleteDialog).toHaveTextContent("Context7");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete MCP" }));
    await waitFor(() => expect(api.removeMcpServer).toHaveBeenCalledWith("context7"));
  });

  it("keeps an MCP draft open when persistence fails", async () => {
    installApi({
      saveMcpServer: vi.fn().mockRejectedValue(new Error("Library is read-only"))
    });
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    fireEvent.click(screen.getByRole("button", { name: "MCPs" }));
    fireEvent.click(screen.getByRole("button", { name: "Add MCP" }));
    fireEvent.change(screen.getByLabelText("MCP library id"), {
      target: { value: "local-search" }
    });
    fireEvent.change(screen.getByLabelText("MCP library name"), {
      target: { value: "Local Search" }
    });
    fireEvent.change(screen.getByLabelText("MCP command"), {
      target: { value: "node" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));

    await screen.findByRole("alert");
    expect(screen.getByRole("dialog", { name: "MCP editor" })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(await screen.findByRole("article", { name: "Agent OpenCode" })).toHaveTextContent("Ready");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(api.listTargets).toHaveBeenCalledTimes(2));
    expect(api.listTargets).toHaveBeenLastCalledWith(true);
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Agent OpenCode" })).toHaveTextContent("Missing")
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Agents refreshed");
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
    const mcp = within(composer).getByRole("button", { name: "MCPs" });
    const advanced = within(composer).getByRole("button", { name: "Advanced" });

    expect(instructions).toHaveAccessibleDescription(/1.*AGENTS\.md/);
    expect(skills).toHaveAccessibleDescription(
      /4.*profile-review.*profile-debug.*\+2/
    );
    expect(mcp).toHaveAccessibleDescription(
      /4.*library-docs.*shared-mcp.*\+2/
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
    expect(screen.getByLabelText("OpenCode settings (opencode.jsonc)")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "History" })).toBeInTheDocument();

    fireEvent.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("OpenCode settings (opencode.jsonc)")).not.toBeInTheDocument();
  });

  it("focuses the active profile without moving it ahead of newer profiles", async () => {
    const activeProfile: ProfileDetail = {
      ...richProfile,
      assetPolicy: {
        ...richProfile.assetPolicy,
        skillRefs: [
          { libraryId: "testing", targetName: "library-testing" },
          { libraryId: "docs", targetName: "library-docs", enabled: false }
        ]
      }
    };
    const checkSkillLibraryUpdates = vi.fn().mockResolvedValue([]);
    const api = installApi({
      listProfiles: vi.fn().mockResolvedValue([
        { ...summaryOf(profileB), createdAt: "2026-07-16T00:00:00.000Z" },
        { ...summaryOf(activeProfile), createdAt: "2026-07-15T00:00:00.000Z" }
      ]),
      readProfile: vi.fn().mockImplementation(async (profileId) =>
        profileId === activeProfile.id ? activeProfile : profileB
      ),
      listTargetStates: vi.fn().mockResolvedValue([managedState()]),
      listSkillLibrary: vi.fn().mockResolvedValue([
        {
          id: "testing",
          name: "Testing",
          description: "Testing workflows",
          path: "/tmp/skills/testing",
          sourceType: "github",
          source: "https://github.com/acme/skills/tree/main/testing",
          updatePolicy: "tracked",
          contentHash: "testing-hash",
          updatedAt: "2026-07-12T00:00:00.000Z"
        },
        {
          id: "docs",
          name: "Docs",
          description: "Documentation workflows",
          path: "/tmp/skills/docs",
          sourceType: "github",
          source: "https://github.com/acme/skills/tree/main/docs",
          updatePolicy: "tracked",
          contentHash: "docs-hash",
          updatedAt: "2026-07-12T00:00:00.000Z"
        }
      ]),
      checkSkillLibraryUpdates
    });
    render(<App />);

    await openProfiles();
    expect(await screen.findByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    const profileRows = profileList.querySelectorAll(".profile-row");
    expect(profileRows[0]).toHaveTextContent("Profile B");
    expect(profileRows[1]).toHaveTextContent("Daily Coding");
    expect(within(profileRows[1] as HTMLElement).queryByText("Current")).not.toBeInTheDocument();

    const skillsRegion = await screen.findByRole("region", { name: "Profile skills" });
    expect(within(skillsRegion).getByRole("switch", { name: "Disable Testing" })).toBeChecked();
    expect(within(skillsRegion).getByRole("switch", { name: "Enable Docs" })).not.toBeChecked();

    checkSkillLibraryUpdates.mockClear();
    fireEvent.click(
      within(skillsRegion).getByRole("button", { name: "Check profile skill updates" })
    );
    await waitFor(() =>
      expect(checkSkillLibraryUpdates).toHaveBeenCalledWith(["testing"])
    );

    fireEvent.click(within(skillsRegion).getByRole("switch", { name: "Disable Testing" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(within(skillsRegion).getByRole("switch", { name: "Enable Testing" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          assetPolicy: expect.objectContaining({
            skillRefs: [
              { libraryId: "testing", targetName: "library-testing", enabled: false },
              { libraryId: "docs", targetName: "library-docs", enabled: false }
            ]
          })
        })
      )
    );
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
    expect(row).toHaveTextContent("4 skills");
    expect(row).toHaveTextContent("4 MCP");
    expect(row).toHaveTextContent("1 file");
    expect(within(row).getByLabelText("Active on: Codex, OpenCode")).toBeInTheDocument();
    expect(within(row).getByTitle("Codex is up to date")).toBeInTheDocument();
    expect(within(row).getByTitle("OpenCode is up to date")).toBeInTheDocument();
    expect(document.querySelector(".profile-hero")).not.toHaveTextContent("Applied Jul 9");

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
    expect(edit).toHaveAttribute("title", "Edit profile");
    expect(more).toHaveAttribute("title", "More profile actions");
    expect(more.closest(".profile-hero")).not.toBeNull();
    expect(more.closest(".profile-page-header")).toBeNull();
    expect(screen.getByLabelText("Current Agent OpenCode")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select apply Agent" })).not.toBeInTheDocument();
  });

  it("keeps whole-profile Save beside Apply in their workflow order", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    const hero = document.querySelector(".profile-hero");
    expect(hero).not.toBeNull();
    const actions = within(hero as HTMLElement).getByRole("group", {
      name: "Selected profile actions"
    });
    const buttons = within(actions).getAllByRole("button").slice(0, 2);

    expect(buttons.map((button) => button.textContent?.trim())).toEqual(["Save", "Apply"]);
    const saveButton = within(actions).getByRole("button", { name: "Save" });
    const applyButton = within(actions).getByRole("button", { name: "Apply" });
    expect(saveButton).toBeDisabled();
    expect(saveButton).not.toHaveClass("is-primary");
    expect(applyButton).toBeEnabled();
    expect(document.querySelector(".profile-page-header .save-button")).toBeNull();
    expect(document.querySelector(".profile-page-header [aria-label='More profile actions']")).toBeNull();
  });

  it("auto-saves profile icons without committing environment draft changes", async () => {
    const metadataSave = deferred<ProfileDetail>();
    const api = installApi({
      updateProfileMetadata: vi.fn().mockReturnValue(metadataSave.promise)
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Unsaved instructions\n" }
    });
    const row = screen.getByRole("group", { name: "Profile Daily Coding" });
    const icon = within(row).getByRole("button", {
      name: "Change icon for profile daily-coding"
    });
    expect(icon).toHaveAttribute("data-icon", "folder");
    fireEvent.click(icon);
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Icons for Daily Coding" })).getByRole(
        "menuitemradio",
        { name: "Design" }
      )
    );

    await waitFor(() =>
      expect(api.updateProfileMetadata).toHaveBeenCalledWith({
        id: "daily-coding",
        iconKey: "palette"
      })
    );
    expect(screen.getAllByText("Saving profile details").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    act(() => metadataSave.resolve({
      ...profile,
      manifest: { ...profile.manifest, iconKey: "palette" }
    }));
    expect(await screen.findByText("Profile details saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(row).toHaveTextContent("Unsaved");
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Unsaved instructions\n");
    expect(api.saveProfile).not.toHaveBeenCalled();
  });

  it("makes Save primary and disables Apply until profile changes are saved", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Updated Agent\n" }
    });

    const saveButton = screen.getByRole("button", { name: "Save" });
    const applyButton = screen.getByRole("button", { name: "Apply" });
    expect(saveButton).toBeEnabled();
    expect(saveButton).toHaveClass("is-primary");
    expect(applyButton).toBeDisabled();
    fireEvent.click(applyButton);

    expect(api.previewApply).not.toHaveBeenCalled();
    fireEvent.click(saveButton);
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(saveButton).not.toHaveClass("is-primary");
    expect(applyButton).toBeEnabled();
  });

  it("keeps dirty readiness informational and prevents duplicate saves", async () => {
    const pendingSave = deferred<ProfileDetail>();
    const api = installApi({ saveProfile: vi.fn().mockReturnValue(pendingSave.promise) });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Pending save\n" }
    });

    const readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Save changes to continue");
    expect(within(readiness).queryByRole("button")).toBeNull();
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(saveButton).toBeDisabled();

    pendingSave.resolve(profile);
    await waitFor(() => expect(readiness).toHaveTextContent("Ready to take over OpenCode"));
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
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    pendingSave.resolve(profile);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  });

  it("enables Apply as soon as Profile persistence finishes without a full refresh", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Fast save\n" }
    });
    vi.mocked(api.listTargets).mockClear();
    vi.mocked(api.listTargetStates).mockClear();
    vi.mocked(api.listProfiles).mockClear();
    vi.mocked(api.listBackups).mockClear();
    vi.mocked(api.scanSkillInventory).mockClear();
    vi.mocked(api.checkSkillLibraryUpdates).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled());
    expect(api.listTargets).not.toHaveBeenCalled();
    expect(api.listTargetStates).not.toHaveBeenCalled();
    expect(api.listProfiles).not.toHaveBeenCalled();
    expect(api.listBackups).not.toHaveBeenCalled();
    expect(api.scanSkillInventory).not.toHaveBeenCalled();
    expect(api.checkSkillLibraryUpdates).not.toHaveBeenCalled();
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
      listProfiles: vi.fn().mockResolvedValue([
        { ...summaryOf(profile), createdAt: "2026-07-15T00:00:00.000Z" },
        { ...summaryOf(codexProfile), createdAt: "2026-07-16T00:00:00.000Z" }
      ]),
      readProfile: vi.fn().mockImplementation(async (profileId) =>
        profileId === codexProfile.id ? codexProfile : profile
      )
    });
    render(<App />);

    await openProfiles();
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    const profileOrder = () =>
      [...profileList.querySelectorAll(".profile-row__name")].map((item) => item.textContent);
    expect(profileOrder()).toEqual(["Codex Review", "Daily Coding"]);
    let menuButton = screen.getByRole("button", { name: "Select apply Agent" });
    expect(menuButton).toHaveTextContent("OpenCode");
    expect(menuButton).not.toHaveTextContent("Target:");
    menuButton.focus();
    fireEvent.click(menuButton);
    let menu = screen.getByRole("menu", { name: "Apply Agents" });
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
    expect(screen.getByRole("button", { name: "Apply" }).querySelector("img"))
      .toHaveClass("profile-target-logo--opencode");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Apply Agents" })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();

    fireEvent.click(menuButton);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Apply Agents" })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();

    fireEvent.click(menuButton);
    menu = screen.getByRole("menu", { name: "Apply Agents" });
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Codex" }));
    expect(within(profileList).getByText("Daily Coding")).toBeInTheDocument();
    const compatibleRow = within(profileList).getByRole("button", { name: /Codex Review/ });
    expect(screen.getByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(profileOrder()).toEqual(["Codex Review", "Daily Coding"]);

    fireEvent.click(compatibleRow);
    expect(await screen.findByRole("heading", { name: "Codex Review" })).toBeInTheDocument();
    expect(api.readProfile).toHaveBeenCalledWith("codex-review");
    expect(profileOrder()).toEqual(["Codex Review", "Daily Coding"]);
    menuButton = screen.getByRole("button", { name: "Select apply Agent" });
    fireEvent.click(menuButton);
    expect(
      within(screen.getByRole("menu", { name: "Apply Agents" })).getByRole(
        "menuitemradio",
        { name: "Codex" }
      )
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Apply Agents" })).getByRole(
        "menuitemradio",
        { name: "OpenCode" }
      )
    );
    fireEvent.click(within(profileList).getByRole("button", { name: /Daily Coding/ }));
    menuButton = await screen.findByRole("button", { name: "Select apply Agent" });
    fireEvent.click(menuButton);
    expect(
      within(screen.getByRole("menu", { name: "Apply Agents" })).getByRole(
        "menuitemradio",
        { name: "Codex" }
      )
    ).toHaveAttribute("aria-checked", "true");
  });

  it("preserves a dirty draft when the checked target is re-selected", async () => {
    installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget])
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    const instructions = screen.getByLabelText("AGENTS.md");
    fireEvent.change(instructions, { target: { value: "# Unsaved target-safe draft\n" } });

    const targetButton = screen.getByRole("button", { name: "Select apply Agent" });
    targetButton.focus();
    fireEvent.click(targetButton);
    const checkedTarget = screen.getByRole("menuitemradio", { name: "OpenCode" });
    expect(checkedTarget).toHaveAttribute("aria-checked", "true");
    fireEvent.click(checkedTarget);

    expect(screen.queryByRole("menu", { name: "Apply Agents" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
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
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    await act(async () => {
      profileCRead.resolve(profileC);
      await profileCRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Profile C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
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
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("profile-b", "opencode"));
    expect(screen.getByRole("button", { name: "Apply" })).toHaveAttribute(
      "aria-busy",
      "true"
    );
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "Reviewing changes"
    );

    deferProfileC = true;
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    fireEvent.click(within(profileList).getByRole("button", { name: /Profile C/ }));
    await act(async () => {
      stalePreview.resolve({ ...preview, profileId: profileB.id });
      await stalePreview.promise;
    });

    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();

    await act(async () => {
      profileCRead.resolve(profileC);
      await profileCRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Profile C" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("keeps header menus exclusive and restores trigger focus", async () => {
    const api = installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget])
    });
    render(<App />);

    await openProfiles();
    const targetButton = screen.getByRole("button", { name: "Select apply Agent" });
    const moreButton = screen.getByRole("button", { name: "More profile actions" });

    fireEvent.click(targetButton);
    expect(screen.getByRole("menu", { name: "Apply Agents" })).toBeInTheDocument();
    fireEvent.click(moreButton);
    expect(screen.queryByRole("menu", { name: "Apply Agents" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Profile actions" })).toBeInTheDocument();

    fireEvent.click(targetButton);
    expect(screen.queryByRole("menu", { name: "Profile actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Apply Agents" })).toBeInTheDocument();

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
    expect(readiness).toHaveTextContent("Ready to take over OpenCode");
    let action = screen.getByRole("button", { name: "Apply" });
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
    expect(readiness).toHaveTextContent("Ready for OpenCode");
    action = screen.getByRole("button", { name: "Apply" });
    expect(action).toHaveAttribute("title", "Preview & apply to OpenCode");

    cleanup();
    installApi({ listProfiles: vi.fn().mockResolvedValue([]) });
    render(<App />);
    await openProfiles();
    expect(screen.queryByRole("status", { name: "Profile readiness" })).toBeNull();
    action = screen.getByRole("button", { name: "Apply" });
    expect(action).toBeDisabled();
    expect(action).toHaveAccessibleDescription("Select a profile before previewing changes");

    cleanup();
    installApi({ listTargets: vi.fn().mockResolvedValue([]) });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Select an Agent");
    expect(screen.queryByRole("button", { name: "Open Agents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

    cleanup();
    const unavailableApi = installApi({
      listTargets: vi.fn().mockResolvedValue([unavailableTarget])
    });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("OpenCode unavailable");
    action = screen.getByRole("button", { name: "Apply" });
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
    expect(readiness).toHaveTextContent("Ready to take over OpenCode");
    action = screen.getByRole("button", { name: "Apply" });
    fireEvent.click(action);
    await waitFor(() => expect(invalidApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    dialog = screen.getByRole("dialog", { name: "Preview" });
    expect(dialog).not.toHaveTextContent("Instructions are empty");
    expect(within(dialog).getByRole("button", { name: "Apply profile" })).toBeEnabled();

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
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(driftApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    action = screen.getByRole("button", { name: "Apply" });
    expect(action).toHaveAttribute("title", "Resolve OpenCode drift");
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Changes need review on OpenCode");
    expect(screen.queryByRole("button", { name: "Review preview" })).not.toBeInTheDocument();
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
        allowManagedDrift: true,
        allowUnmanagedSkillReplacement: true,
        allowOmissions: false
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
      "Up to date on OpenCode"
    );
    const action = screen.getByRole("button", { name: "Apply" });
    expect(action).toBeDisabled();
    expect(action).toHaveTextContent("Apply");
    fireEvent.click(action);
    expect(api.previewApply).not.toHaveBeenCalled();
  });

  it("uses explicit destinations only for readiness issues outside the apply flow", async () => {
    installApi({
      readProfile: vi.fn().mockResolvedValue({ ...profile, configText: "{" })
    });
    render(<App />);

    await openProfiles();
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "Profile configuration needs review"
    );
    const openAdvanced = screen.getByRole("button", { name: "Open Advanced" });
    expect(openAdvanced).toHaveTextContent("Open Advanced");
    fireEvent.click(openAdvanced);
    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    cleanup();
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({ lifecycleStatus: "recovery-required" })
      ])
    });
    render(<App />);

    await openProfiles();
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "Recovery required on OpenCode"
    );
    const openRecovery = screen.getByRole("button", { name: "Open Recovery" });
    expect(openRecovery).toHaveTextContent("Open Recovery");
    fireEvent.click(openRecovery);
    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
  });

  it("lists every active target and routes profile deletion recovery to Targets", async () => {
    const api = installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      listTargetStates: vi.fn().mockResolvedValue([
        managedState(),
        managedState({ targetId: "codex" })
      ])
    });
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete profile" }));

    const deleteDialog = screen.getByRole("dialog", { name: "Delete profile" });
    expect(deleteDialog).toHaveTextContent("OpenCode, Codex");
    expect(deleteDialog).toHaveTextContent("Apply another profile or stop managing each Agent");
    expect(within(deleteDialog).queryByRole("button", { name: "Remove profile" })).toBeNull();
    expect(api.deleteProfile).not.toHaveBeenCalled();
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Open Agents" }));
    expect(await screen.findByRole("heading", { name: "Agents" })).toBeInTheDocument();
  });

  it("shows target management status on the Targets page", async () => {
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        {
          targetId: "opencode",
          activeProfileId: "daily-coding",
          activeProfileName: "Daily Coding",
          status: "managed",
          lifecycleStatus: "applied",
          lastAppliedAt: "2026-07-09T00:00:00.000Z",
          managedResourceCount: 3,
          warningCount: 0,
          errorCount: 0
        }
      ])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    const openCodeCard = await screen.findByRole("article", { name: "Agent OpenCode" });
    expect(within(openCodeCard).getByText("Applied")).toBeInTheDocument();
    expect(within(openCodeCard).getByText("Active profile")).toBeInTheDocument();
    expect(within(openCodeCard).getByText("Daily Coding")).toBeInTheDocument();
  });

  it("reviews and confirms Stop Managing from Target diagnostics", async () => {
    const api = installApi({
      listTargetStates: vi.fn().mockResolvedValue([managedState()])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show OpenCode diagnostics" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop managing OpenCode" }));

    const choiceDialog = screen.getByRole("dialog", { name: "Stop managing Agent" });
    expect(within(choiceDialog).getByText("Keep current environment")).toBeInTheDocument();
    fireEvent.click(within(choiceDialog).getByRole("button", { name: "Review changes" }));

    expect(api.previewStopManaging).toHaveBeenCalledWith("opencode", "keep-current");
    const previewDialog = await screen.findByRole("dialog", { name: "Preview" });
    expect(within(previewDialog).getByText(/files will stay in place/)).toBeInTheDocument();
    fireEvent.click(within(previewDialog).getByRole("button", { name: "Keep files and detach" }));

    await waitFor(() => expect(api.stopManaging).toHaveBeenCalledWith("stop-managing-1"));
  });

  it("previews, cancels, and restores an AgentEnv data backup from Settings", async () => {
    const api = installApi({
      selectDataRestore: vi.fn().mockResolvedValue({
        path: "/tmp/AgentEnv-Backup",
        createdAt: "2026-07-12T00:00:00.000Z",
        formatVersion: 1,
        topLevelItemCount: 6
      })
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const restoreTrigger = screen.getByRole("button", { name: "Restore data" });
    restoreTrigger.focus();
    fireEvent.click(restoreTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Restore AgentEnv data" });
    expect(dialog).toHaveTextContent("6 top-level items");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Restore AgentEnv data" })).not.toBeInTheDocument();
    expect(restoreTrigger).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Restore data" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Restore AgentEnv data" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Restore data" }));
    await waitFor(() =>
      expect(api.restoreDataBackup).toHaveBeenCalledWith("/tmp/AgentEnv-Backup")
    );
    expect(await screen.findByText(/AgentEnv data restored; safety backup created/)).toBeInTheDocument();
  });

  it("manages backup retention, protected recovery points, deletion, and cleanup from Settings", async () => {
    const requiredBackup = {
      id: "required-backup",
      kind: "target-recovery" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      sizeBytes: 4096,
      fileCount: 2,
      operation: "apply" as const,
      targetId: "opencode",
      profileName: "Daily Coding",
      cleanupStatus: "required" as const,
      requiredReason: "takeover-baseline" as const,
      deletable: false
    };
    const eligibleBackup = {
      id: "cleanup-old",
      kind: "skill-cleanup" as const,
      createdAt: "2026-01-02T00:00:00.000Z",
      sizeBytes: 2048,
      fileCount: 1,
      operation: "cleanup" as const,
      libraryId: "reviewer",
      cleanupStatus: "eligible" as const,
      deletable: true
    };
    const listManagedBackups = vi.fn().mockResolvedValue({
      items: [requiredBackup, eligibleBackup],
      totalBytes: 6144,
      eligibleBytes: 2048,
      eligibleCount: 1,
      retentionDays: 30
    });
    const api = installApi({
      listManagedBackups,
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: 30
      })
    });
    render(<App />);

    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByText("2 backups · 6.0 KB")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Backup retention"), { target: { value: "90" } });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ backupRetentionDays: 90 }));

    fireEvent.click(screen.getByRole("button", { name: /^Manage$/ }));
    const manager = await screen.findByRole("dialog", { name: "Manage Backups" });
    expect(within(manager).getByText("Takeover baseline")).toBeInTheDocument();
    expect(within(manager).getByText("Required")).toBeInTheDocument();
    expect(within(manager).queryByRole("button", { name: /Delete backup Daily Coding/ })).not.toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", { name: /Delete backup Skill cleanup/ }));
    expect(within(manager).getByText("Delete backup?")).toBeInTheDocument();
    fireEvent.click(within(manager).getByRole("button", { name: "Cancel" }));
    expect(within(manager).getByText("Manage Backups")).toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", { name: "Clean up now" }));
    expect(within(manager).getByText("Clean up backups?")).toBeInTheDocument();
    fireEvent.click(within(manager).getByRole("button", { name: "Clean up 1 backup" }));
    await waitFor(() => expect(api.cleanupManagedBackups).toHaveBeenCalledOnce());
    expect(await within(manager).findByText("Deleted 0 backups · Freed 0 B")).toBeInTheDocument();
  });

  it("creates, edits, duplicates, and deletes profiles from the profile workspace", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit profile" });
    fireEvent.change(within(editDialog).getByLabelText("Profile name"), {
      target: { value: "" }
    });
    expect(within(editDialog).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeInTheDocument();
    fireEvent.change(within(editDialog).getByLabelText("Profile name"), {
      target: { value: "Review Focus" }
    });
    fireEvent.change(within(editDialog).getByLabelText("Description"), {
      target: { value: "Review and quality checks" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(api.updateProfileMetadata).toHaveBeenCalledWith({
        id: "daily-coding",
        name: "Review Focus",
        description: "Review and quality checks"
      })
    );
    expect(await screen.findByText("Profile details saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(api.saveProfile).not.toHaveBeenCalled();

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

  it("reviews and creates a managed profile from a Target", async () => {
    const capturedProfile: ProfileDetail = {
      ...profile,
      id: "captured-opencode",
      manifest: {
        ...profile.manifest,
        id: "captured-opencode",
        name: "OpenCode Current",
        description: "Captured from OpenCode"
      }
    };
    const api = installApi({
      previewCreateProfileFromTarget: vi.fn().mockResolvedValue({
        id: "capture-preview",
        targetId: "opencode",
        targetName: "OpenCode",
        suggestedName: "OpenCode Current",
        createdAt: "2026-07-14T00:00:00.000Z",
        resources: [
          {
            kind: "skill",
            id: "review-workflow",
            name: "review-workflow",
            libraryId: "review-workflow",
            action: "import",
            detail: "2 source copies stay unchanged"
          },
          {
            kind: "instructions",
            id: "instructions",
            name: "AGENTS.md",
            action: "include"
          }
        ],
        warnings: [],
        errors: []
      }),
      createProfileFromTarget: vi.fn().mockResolvedValue({
        profile: capturedProfile,
        targetId: "opencode",
        importedSkillCount: 1,
        importedMcpCount: 0,
        warnings: []
      })
    });
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    let dialog = screen.getByRole("dialog", { name: "New profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "From Agent" }));
    dialog = screen.getByRole("dialog", { name: "Create profile from OpenCode" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));

    await waitFor(() => expect(api.previewCreateProfileFromTarget).toHaveBeenCalledWith("opencode"));
    dialog = screen.getByRole("dialog", { name: "Review OpenCode capture" });
    const impact = within(dialog).getByRole("region", { name: "Capture impact" });
    expect(within(impact).getByLabelText("Capture summary")).toHaveTextContent("0Source changes");
    expect(within(dialog).getByText("2 source copies stay unchanged")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    dialog = screen.getByRole("dialog", { name: "Create profile from OpenCode" });
    expect(within(dialog).getByLabelText("Profile name")).toHaveValue("OpenCode Current");
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));
    dialog = await screen.findByRole("dialog", { name: "Review OpenCode capture" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Profile" }));

    await waitFor(() =>
      expect(api.createProfileFromTarget).toHaveBeenCalledWith({
        previewId: "capture-preview",
        name: "OpenCode Current"
      })
    );
    expect(await screen.findByText("OpenCode Current created. Agent unchanged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("keeps the Targets workspace and restores context when capture is cancelled", async () => {
    installApi();
    render(<App />);

    await screen.findByRole("region", { name: "Skill library" });
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    const targetsWorkspace = await screen.findByRole("region", { name: "Agents" });
    const targetCard = within(targetsWorkspace).getByRole("article", { name: "Agent OpenCode" });
    fireEvent.click(within(targetCard).getByRole("button", { name: "Create profile from OpenCode" }));

    const dialog = screen.getByRole("dialog", { name: "Create profile from OpenCode" });
    expect(screen.getByRole("region", { name: "Agents" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Create profile from OpenCode" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Agents" })).toBeInTheDocument();
  });

  it("keeps capture failures inside the dialog and refreshes the review in place", async () => {
    const api = installApi({
      previewCreateProfileFromTarget: vi
        .fn()
        .mockRejectedValueOnce(new Error("Agent changed while it was being reviewed"))
        .mockResolvedValueOnce({
          id: "refreshed-capture-preview",
          targetId: "opencode",
          targetName: "OpenCode",
          suggestedName: "OpenCode Current",
          createdAt: "2026-07-14T00:00:00.000Z",
          resources: [],
          warnings: [],
          errors: []
        })
    });
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "From Agent" }));
    let dialog = screen.getByRole("dialog", { name: "Create profile from OpenCode" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));

    const localError = await within(dialog).findByRole("alert");
    expect(localError).toHaveTextContent("Agent changed while it was being reviewed");
    expect(screen.queryByText("Action failed")).not.toBeInTheDocument();
    fireEvent.click(within(localError).getByRole("button", { name: "Refresh review" }));

    dialog = await screen.findByRole("dialog", { name: "Review OpenCode capture" });
    expect(api.previewCreateProfileFromTarget).toHaveBeenCalledTimes(2);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
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

    fireEvent.click(
      within(screen.getByRole("complementary", { name: "Global navigation" })).getByRole(
        "button",
        { name: "Skills" }
      )
    );
    const navigationGuard = screen.getByRole("dialog", { name: "Unsaved profile changes" });
    expect(navigationGuard).toHaveTextContent("open Skills");
    fireEvent.click(within(navigationGuard).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Profiles" })).toBeInTheDocument();

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
    await waitFor(() => expect(api.setWindowCloseGuard).toHaveBeenLastCalledWith(true));
    act(() => requestClose());

    const guard = await screen.findByRole("dialog", { name: "Unsaved profile changes" });
    expect(guard).toHaveTextContent("close AgentEnv Manager");
    fireEvent.click(within(guard).getByRole("button", { name: "Discard changes" }));
    expect(api.confirmWindowClose).toHaveBeenCalledOnce();
  });

  it("cancels an operating-system quit request when the dirty guard is dismissed", async () => {
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
      target: { value: "# Keep this draft open\n" }
    });
    act(() => requestClose());
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Unsaved profile changes" })).getByRole(
        "button",
        { name: "Cancel" }
      )
    );

    expect(api.cancelWindowClose).toHaveBeenCalledOnce();
    expect(api.confirmWindowClose).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(screen.queryByRole("region", { name: "History" })).not.toBeInTheDocument();
    const recoveryTrigger = screen.getByRole("button", { name: /Recovery/ });
    fireEvent.click(recoveryTrigger);
    const recoveryDialog = await screen.findByRole("dialog", { name: "Recovery" });
    const history = within(recoveryDialog).getByRole("region", { name: "History" });
    fireEvent.click(
      within(history).getByRole("button", { name: "Preview restore Daily Coding" })
    );

    await waitFor(() => expect(api.previewRollback).toHaveBeenCalledWith(backup.id));
    expect(screen.queryByRole("dialog", { name: "Recovery" })).not.toBeInTheDocument();
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
