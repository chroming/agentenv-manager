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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, AppFeedback } from "../../src/renderer/App";
import { reconcileImportedSkillUpdates } from "../../src/renderer/skillUpdateSummary";
import type {
  ActivationPreview,
  AgentEnvApi,
  AgentEnvSettings,
  ApplyIssue,
  ProfileDetail,
  SkillInventoryEntry,
  SkillLibraryEntry,
  SkillUpdateInfo,
  TargetInfo,
  TargetManagementState
} from "../../src/shared/types";

const profile: ProfileDetail = {
  id: "daily-coding",
  profileDir: "/tmp/profiles/daily-coding",
  manifest: {
    id: "daily-coding",
    preferredTargetId: "opencode",
    name: "Daily Coding",
    description: "Default",
    version: 2
  },
  instructions: "# Agent\n",
  resources: { skills: [], mcpByTarget: {} },
  contentHash: "profile-hash",
  targetContentHashes: {
    opencode: "profile-hash",
    codex: "codex-profile-hash",
    "claude-code": "claude-profile-hash"
  }
};

const preview: ActivationPreview = {
  id: "preview-1",
  profileId: "daily-coding",
  profileContentHash: "profile-hash",
  libraryVersions: { skills: {} },
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  issues: [{
    id: "unmanaged-skill-preserved:manual-reviewer",
    code: "unmanaged-skill-location",
    disposition: "notice",
    resolution: "preserve",
    resourceKind: "skill",
    resourceId: "manual-reviewer",
    path: "/tmp/home/.config/opencode/skills/manual-reviewer",
    message: "Unmanaged local Skill manual-reviewer will be preserved"
  }],
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
  targetState: { managedMcpNames: [] }
};

const localStorageValues = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return localStorageValues.size;
  },
  clear: () => localStorageValues.clear(),
  getItem: (key) => localStorageValues.get(key) ?? null,
  key: (index) => Array.from(localStorageValues.keys())[index] ?? null,
  removeItem: (key) => {
    localStorageValues.delete(key);
  },
  setItem: (key, value) => {
    localStorageValues.set(key, String(value));
  }
};

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock
  });
  window.localStorage.clear();
});

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
    disabledSkillPaths: false,
    mcpActivation: true,
    evaluation: true
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
  },
  conversationCapabilities: {
    history: { state: "available", evidence: ["test"] },
    openOriginal: { state: "available", evidence: ["test"] },
    continue: { state: "available", evidence: ["test"] }
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
    preferredTargetId: "codex",
    name: "Codex Review",
    description: "Review setup"
  }
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
  resources: {
    skills: [
      { libraryId: "testing", targetName: "library-testing", enabled: true },
      { libraryId: "docs", targetName: "library-docs", enabled: true }
    ],
    mcpByTarget: {
      opencode: {
        mode: "manage",
        selections: [
          { name: "library-docs", enabled: true },
          { name: "shared-mcp", enabled: true },
          { name: "raw-search", enabled: false },
          { name: "raw-browser", enabled: true }
        ]
      }
    }
  }
};

const summaryOf = (detail: ProfileDetail) => ({
  id: detail.id,
  preferredTargetId: detail.manifest.preferredTargetId,
  createdFromTargetId: detail.manifest.createdFromTargetId,
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
  appliedLibraryVersions: { skills: {} },
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
    runtimeVersion: 7,
    platform: "darwin",
    readStartupStatus: vi.fn().mockResolvedValue({ state: "ready" }),
    onStartupStatusChanged: vi.fn().mockReturnValue(() => undefined),
    retryStartup: vi.fn().mockResolvedValue(undefined),
    openStartupDataFolder: vi.fn().mockResolvedValue(undefined),
    exportStartupDiagnostics: vi.fn().mockResolvedValue(undefined),
    readDiagnosticIssue: vi.fn().mockResolvedValue(undefined),
    readLatestDiagnosticIssue: vi.fn().mockResolvedValue(undefined),
    exportDiagnostics: vi.fn().mockResolvedValue(undefined),
    openDiagnosticsFolder: vi.fn().mockResolvedValue(undefined),
    reportRendererError: vi.fn(),
    quitApp: vi.fn(),
    onOpenSettingsRequested: vi.fn().mockReturnValue(() => undefined),
    onWindowCloseRequested: vi.fn().mockReturnValue(() => undefined),
    setWindowCloseGuard: vi.fn(),
    confirmWindowClose: vi.fn(),
    cancelWindowClose: vi.fn(),
    readWindowChromeState: vi.fn().mockResolvedValue({ fullScreen: false }),
    onWindowChromeStateChanged: vi.fn().mockReturnValue(() => undefined),
    openContextMenu: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined),
    selectSkillFolder: vi.fn().mockResolvedValue(undefined),
    selectLocalSkillSource: vi.fn().mockResolvedValue(undefined),
    releaseSkillArchive: vi.fn().mockResolvedValue(undefined),
    selectTargetConfigRoot: vi.fn().mockResolvedValue(undefined),
    selectComparisonWorkspace: vi.fn().mockResolvedValue(undefined),
    previewProfileComparison: vi.fn().mockRejectedValue(new Error("Comparison unavailable")),
    startProfileComparison: vi.fn().mockRejectedValue(new Error("Comparison unavailable")),
    readProfileComparison: vi.fn().mockResolvedValue(undefined),
    cancelProfileComparison: vi.fn().mockRejectedValue(new Error("Comparison unavailable")),
    listSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
    listTargets: vi.fn().mockResolvedValue([target]),
    listTargetStates: vi.fn().mockResolvedValue([]),
    listConversations: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    searchConversations: vi.fn().mockResolvedValue([]),
    readConversation: vi.fn().mockRejectedValue(new Error("Conversation not found")),
    refreshConversations: vi.fn().mockResolvedValue({
      indexed: 0,
      unchanged: 0,
      removed: 0,
      failures: []
    }),
    openOriginalConversation: vi.fn().mockResolvedValue({
      mode: "native",
      message: "Opened"
    }),
    previewConversationContinuation: vi.fn().mockRejectedValue(
      new Error("Conversation not found")
    ),
    continueConversation: vi.fn().mockResolvedValue({
      mode: "context-file",
      message: "Started"
    }),
    listNativeMcpConnections: vi.fn().mockResolvedValue({ connections: [], issues: [] }),
    listSkillLibrary: vi.fn().mockResolvedValue([]),
    listSkillFiles: vi.fn().mockResolvedValue([]),
    readSkillFile: vi.fn().mockResolvedValue({
      path: "SKILL.md",
      kind: "text",
      sizeBytes: 0,
      content: ""
    }),
    scanSkillInventory: vi.fn().mockResolvedValue([]),
    listSkillCleanupBackups: vi.fn().mockResolvedValue([]),
    setUnmanagedSkillLocations: vi.fn().mockResolvedValue([]),
    setSkillCollectionDecision: vi.fn().mockResolvedValue([]),
    scanUnmanagedSkills: vi.fn().mockResolvedValue([]),
    scanLocalSkillSource: vi.fn().mockResolvedValue({
      roots: [],
      candidates: [],
      issues: [],
      scannedDirectories: 0,
      truncated: false
    }),
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
      conflicts: []
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
      sourceScope: {
        formatVersion: 1,
        canonicalLink: "https://github.com/acme/skills/tree/main",
        repository: "https://github.com/acme/skills.git",
        ref: "main",
        directory: ""
      },
      truncated: false,
      candidates: []
    }),
    importGitHubSkills: vi.fn().mockResolvedValue({ imported: [], failed: [] }),
    scanRepositorySkills: vi.fn().mockResolvedValue({
      repository: "git@example.test:team/skills.git",
      ref: "main",
      directory: "",
      transport: "system-git",
      sourceScope: {
        formatVersion: 1,
        canonicalLink: "git@example.test:team/skills#ref=main",
        repository: "git@example.test:team/skills.git",
        ref: "main",
        directory: ""
      },
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
    listSkillSourceGroups: vi.fn().mockResolvedValue([]),
    setSkillSourceName: vi.fn(),
    checkSkillSourceGroup: vi.fn(),
    checkMonitoredSkillSourceGroups: vi.fn().mockResolvedValue({ groups: [], checked: 0, failed: 0 }),
    setSkillSourceMonitored: vi.fn().mockImplementation(async ({ sourceId, enabled }) => ({
      formatVersion: 1,
      sourceId,
      sourceKind: "repository",
      automaticChecks: enabled,
      canonicalLink: "https://github.com/acme/skills",
      repository: "https://github.com/acme/skills.git",
      ref: "main",
      directory: "",
      observationState: "unchecked",
      counts: { total: 0, updates: 0, new: 0, removed: 0 },
      candidates: []
    })),
    setSkillSourceCandidateIgnored: vi.fn(),
    previewSkillSourceMerge: vi.fn(),
    mergeSkillSources: vi.fn(),
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
    retireSkillCollection: vi.fn().mockResolvedValue({
      backupId: "retire-collection-backup",
      libraryId: "_collection",
      managedLocations: ["/tmp/shared/collection"],
      operation: "retire"
    }),
    rollbackSkillCleanup: vi.fn().mockResolvedValue(undefined),
    setSkillUpdateSettings: vi.fn().mockImplementation(async (input) => ({
      id: input.policy.id,
      name: input.policy.id,
      description: "",
      path: "/tmp/skill",
      sourceType: input.source?.sourceType ?? "local",
      source: input.source?.source ?? "/tmp/skill",
      updatePolicy: input.policy.policy,
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
    previewLibrarySkillUpdates: vi.fn().mockResolvedValue({ plans: [], failed: [] }),
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
      conversationTerminal: "default",
      skillSyncMethod: "symlink",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null
    }),
    updateSettings: vi.fn().mockImplementation(async (input) => ({
      locale: input.locale ?? "system",
      conversationTerminal: input.conversationTerminal ?? "default",
      skillSyncMethod: input.skillSyncMethod ?? "symlink",
      skillStorageLocation: input.skillStorageLocation ?? "appData",
      skillAutoCheckEnabled: input.skillAutoCheckEnabled ?? true,
      skillAutoCheckIntervalMinutes: input.skillAutoCheckIntervalMinutes ?? 60,
      backupRetentionDays: input.backupRetentionDays ?? null,
      enabledTargetIds: input.enabledTargetIds
    })),
    readWorkspaceSyncStatus: vi.fn().mockResolvedValue({
      kind: "not-connected",
      localChangeCount: 0,
      remoteChangeCount: 0,
      conflictCount: 0,
      immediateAgentCount: 0
    }),
    connectWorkspaceSync: vi.fn(),
    checkWorkspaceSync: vi.fn(),
    reviewWorkspaceSync: vi.fn(),
    updateWorkspaceFromSync: vi.fn(),
    publishWorkspaceSync: vi.fn(),
    recoverWorkspaceSync: vi.fn(),
    disconnectWorkspaceSync: vi.fn(),
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
          preferredTargetId: "opencode",
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
    updateProfileSkills: vi.fn().mockImplementation(async (input) => ({
      changed: true,
      profile: {
        ...profile,
        resources: {
          ...profile.resources,
          skills: input.skills
        }
      }
    })),
    forkProfileSkills: vi.fn().mockImplementation(async (input) => ({
      changed: true,
      profile: {
        ...profile,
        id: "daily-coding-open-code",
        manifest: {
          ...profile.manifest,
          id: "daily-coding-open-code",
          name: input.name,
          preferredTargetId: input.targetId
        },
        resources: {
          ...profile.resources,
          skills: input.skills
        }
      }
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
      id: `${input.preferredTargetId}-created`,
      manifest: {
        ...profile.manifest,
        id: `${input.preferredTargetId}-created`,
        preferredTargetId: input.preferredTargetId,
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
    previewManagedBackup: vi.fn().mockResolvedValue({
      id: "backup",
      kind: "target-recovery",
      files: []
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
    readDataRoot: vi.fn().mockResolvedValue("/tmp/agentenv-data"),
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
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("App", () => {
  it("opens Settings from the native menu event and marks active navigation", async () => {
    let requestSettings: (() => void) | undefined;
    installApi({
      onOpenSettingsRequested: vi.fn((callback) => {
        requestSettings = callback;
        return () => undefined;
      })
    });
    render(<App />);

    expect(await screen.findByRole("region", { name: "Agents" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agents" }))
      .toHaveAttribute("aria-current", "page");

    requestSettings?.();

    expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" }))
      .toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Agents" }))
      .not.toHaveAttribute("aria-current");
  });

  it("shows the detected Agent and waits for explicit first-run configuration", async () => {
    installApi({
      listProfiles: vi.fn().mockResolvedValue([]),
      listTargetStates: vi.fn().mockResolvedValue([])
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    expect(
      within(workspace).getByRole("article", { name: "Agent OpenCode" })
    ).toBeInTheDocument();
    expect(
      within(workspace).getByRole("button", { name: "Configure OpenCode" })
    ).toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "Capture" })).not.toBeInTheDocument();
    const moreActions = within(workspace).getByRole("button", {
      name: "More actions for OpenCode"
    });
    fireEvent.click(moreActions);
    const agentMenu = screen.getByRole("menu", { name: "Agent actions" });
    expect(within(agentMenu).getByRole("menuitem", { name: "Capture" })).toBeEnabled();
    expect(within(agentMenu).getByRole("menuitem", { name: "Diagnostics" })).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Agent actions" })).not.toBeInTheDocument();
    expect(moreActions).toHaveFocus();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await within(workspace).findByText("Set up your first Agent")).toBeInTheDocument();
    expect(
      within(
        within(workspace).getByRole("region", { name: "Environment status" })
      ).getByRole("button", { name: "Configure Agent" })
    ).toBeEnabled();
    expect(window.localStorage.getItem("agentenv:last-workspace")).toBeNull();
  });

  it("keeps Agent configuration available while the environment scan is pending", async () => {
    const inventoryRequest =
      deferred<Awaited<ReturnType<AgentEnvApi["scanSkillInventory"]>>>();
    installApi({
      scanSkillInventory: vi.fn().mockReturnValue(inventoryRequest.promise)
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    expect(within(workspace).getByText("Checking local Skills")).toBeInTheDocument();
    expect(
      within(workspace).getByRole("button", { name: "Configure OpenCode" })
    ).toBeEnabled();

    await act(async () => {
      inventoryRequest.resolve([]);
      await Promise.resolve();
    });
    expect(await within(workspace).findByText("Environment ready")).toBeInTheDocument();
  });

  it("keeps Agents usable when the optional environment scan fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    installApi({
      scanSkillInventory: vi.fn().mockRejectedValue(
        new Error("Local inventory is temporarily unavailable")
      )
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    expect(
      await within(workspace).findByText("Environment check unavailable")
    ).toBeInTheDocument();
    expect(
      within(workspace).getByRole("button", { name: "Configure OpenCode" })
    ).toBeEnabled();
    expect(
      within(
        within(workspace).getByRole("region", { name: "Environment status" })
      ).getByRole("button", { name: "Retry check" })
    ).toBeEnabled();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("Local Skill inventory is unavailable")
    );
  });

  it("reviews only shared compatibility Skills from the Agents environment status", async () => {
    const inventory: SkillInventoryEntry[] = [
      {
        id: "shared-review",
        name: "Shared review",
        description: "Loaded from the shared compatibility path",
        path: "/tmp/home/.agents/skills/shared-review",
        foundIn: ["opencode"],
        status: "outside",
        skillKey: "shared-review",
        contentHash: "shared-hash",
        sharedLocation: true,
        sharedLocationId: "agents-skills",
        locationManagement: "migration-only"
      },
      {
        id: "agent-only",
        name: "Agent only",
        description: "Only in the Agent-specific path",
        path: "/tmp/home/.config/opencode/skills/agent-only",
        foundIn: ["opencode"],
        status: "outside",
        skillKey: "agent-only",
        contentHash: "agent-hash"
      }
    ];
    installApi({
      scanSkillInventory: vi.fn().mockResolvedValue(inventory)
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    expect(
      await within(workspace).findByText("1 shared Skill needs review")
    ).toBeInTheDocument();
    const environmentStatus = within(workspace).getByRole("region", {
      name: "Environment status"
    });
    expect(
      within(environmentStatus).getByText(
        "Shared locations are used by OpenCode."
      )
    ).toHaveAttribute("data-ui-overflow-detail", "true");
    fireEvent.click(
      within(environmentStatus).getByRole("button", { name: "Review Skills" })
    );

    const drawer = await screen.findByRole("region", { name: "Environment skills" });
    expect(within(drawer).getByText("Shared Skill Review")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("group", { name: "Cleanup group shared-review" })
    ).toBeInTheDocument();
    expect(
      within(drawer).queryByRole("group", { name: "Cleanup group agent-only" })
    ).toBeNull();
  });

  it("names an Agent lifecycle review after the affected Profile", async () => {
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({
          lifecycleStatus: "pending",
          lifecycleReason: "Saved Profile changed after the last Apply"
        })
      ])
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    const environmentStatus = await within(workspace).findByRole("region", {
      name: "Environment status"
    });
    expect(
      await within(environmentStatus).findByText("1 Agent needs review")
    ).toBeInTheDocument();
    expect(
      within(environmentStatus).getByRole("button", { name: "Review Profile" })
    ).toBeEnabled();
    expect(
      within(environmentStatus).queryByRole("button", { name: "Review" })
    ).toBeNull();
  });

  it("keeps applied local overrides in Agent detail without promoting them globally", async () => {
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({
          lifecycleStatus: "applied-with-local-override",
          lifecycleReason: "1 local management boundary is active on this device"
        })
      ])
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    const environmentStatus = await within(workspace).findByRole("region", {
      name: "Environment status"
    });
    expect(
      within(environmentStatus).getByText("Environment ready")
    ).toBeInTheDocument();
    expect(
      within(environmentStatus).queryByText(/Agent needs review/)
    ).toBeNull();
    expect(
      within(environmentStatus).queryByText(/local exceptions/i)
    ).toBeNull();
    expect(
      within(environmentStatus).queryByRole("button", { name: "Review Profile" })
    ).toBeNull();
    expect(
      within(within(workspace).getByRole("article", { name: "Agent OpenCode" }))
        .getByText("Local overrides")
    ).toBeInTheDocument();
  });

  it("orders the primary navigation by the environment workflow", async () => {
    installApi();
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    const agents = within(navigation).getByRole("button", { name: "Agents" });
    const profiles = within(navigation).getByRole("button", { name: "Profiles" });
    const conversations = within(navigation).getByRole("button", {
      name: "Conversations"
    });
    const skills = within(navigation).getByRole("button", { name: "Skills" });

    expect(agents.compareDocumentPosition(profiles) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(profiles.compareDocumentPosition(conversations) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(conversations.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("keeps macOS window chrome quiet and page actions in their content", async () => {
    installApi();
    render(<App />);

    const titlebar = document.querySelector<HTMLElement>(".shell-titlebar")!;
    const editor = screen.getByRole("main").querySelector<HTMLElement>(".editor-panel")!;
    const navigation = await screen.findByRole("navigation", { name: "Workspace" });
    expect(within(titlebar).queryByRole("heading")).not.toBeInTheDocument();
    expect(within(titlebar).queryByRole("button", { name: "Refresh" }))
      .not.toBeInTheDocument();
    expect(within(editor).getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Refresh" })).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Profiles" }));
    expect(await within(editor).findByRole("heading", { name: "Profiles" }))
      .toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "New Profile" }))
      .toBeInTheDocument();
    expect(within(titlebar).queryByRole("button", { name: "New Profile" }))
      .not.toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Skills" }));
    expect(await within(editor).findByRole("heading", { name: "Skills" }))
      .toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Import skills" }))
      .toBeInTheDocument();
    expect(within(editor).queryByRole("button", { name: "Scan local" }))
      .not.toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "More Skill actions" }))
      .toBeInTheDocument();
  });

  it("opens an indexed conversation directly from Quick Open content search", async () => {
    const conversation = {
      id: "codex:release-session",
      agentId: "codex",
      agentName: "Codex",
      sourceId: "release-session",
      title: "Release investigation",
      snippet: "Investigate a failing release",
      matchSnippet: "The release used an old token.",
      workspacePath: "/work/project",
      createdAt: "2026-07-24T05:00:00.000Z",
      updatedAt: "2026-07-24T06:00:00.000Z",
      messageCount: 2,
      detailState: "full" as const
    };
    const searchConversations = vi.fn().mockResolvedValue([conversation]);
    const listConversations = vi.fn().mockResolvedValue({
      items: [conversation],
      total: 1,
      workspacePaths: ["/work/project"],
      agentCounts: { codex: 1 }
    });
    const readConversation = vi.fn().mockResolvedValue({
      ...conversation,
      messages: [
        { id: "user", role: "user", text: "Find the release issue." },
        { id: "assistant", role: "assistant", text: "The release used an old token." }
      ]
    });
    const api = installApi({
      listTargets: vi.fn().mockResolvedValue([codexTarget]),
      searchConversations,
      listConversations,
      readConversation
    });
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: "Workspace" });
    fireEvent.click(within(navigation).getByRole("button", { name: /^Quick open/ }));
    const quickOpen = screen.getByRole("dialog", { name: "Quick open" });
    fireEvent.change(within(quickOpen).getByRole("combobox"), {
      target: { value: "old token" }
    });
    const result = await within(quickOpen).findByRole("option", {
      name: /Release investigation/
    });

    expect(searchConversations).toHaveBeenCalledWith({
      query: "old token",
      limit: 6
    });
    await waitFor(() => expect(api.refreshConversations).toHaveBeenCalledTimes(1));
    fireEvent.click(result);

    expect(await screen.findByRole("searchbox", {
      name: "Search conversations"
    })).toHaveValue("old token");
    expect(
      await screen.findAllByText("The release used an old token.")
    ).toHaveLength(2);
    expect(readConversation).toHaveBeenCalledWith(
      conversation.id,
      { limit: 60, tail: true, query: "old token" }
    );
  });

  it("starts in Agents instead of restoring the last workspace", async () => {
    installApi();
    const firstLaunch = render(<App />);
    await screen.findByRole("region", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await screen.findByRole("region", { name: "Settings" });
    firstLaunch.unmount();

    window.localStorage.setItem("agentenv:last-workspace", "conversations");
    installApi();
    render(<App />);

    expect(await screen.findByRole("region", { name: "Agents" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Conversations" })).not.toBeInTheDocument();
  });

  it("replaces stale same-id update results with the revision that was just imported", () => {
    const stale: SkillUpdateInfo = {
      id: "yao-meta-skill",
      name: "Yao Meta Skill",
      sourceType: "git",
      currentRevision: "old-tree",
      latestRevision: "6c738f8c4fbbca60601299b9295ecf8e931e7afa",
      updateAvailable: true
    };
    const imported = {
      id: "yao-meta-skill",
      name: "Yao Meta Skill",
      description: "Meta skill",
      path: "/tmp/library/yao-meta-skill",
      sourceType: "git",
      source: "https://github.com/yaojingang/yao-meta-skill.git",
      remoteRevision: "6c738f8c4fbbca60601299b9295ecf8e931e7afa",
      updatePolicy: "tracked",
      contentHash: "content",
      updatedAt: "2026-07-22T00:00:00.000Z"
    } satisfies SkillLibraryEntry;

    expect(reconcileImportedSkillUpdates([stale], [imported])).toEqual([
      expect.objectContaining({
        id: "yao-meta-skill",
        currentRevision: imported.remoteRevision,
        latestRevision: imported.remoteRevision,
        updateAvailable: false
      })
    ]);
  });
  it("auto-dismisses successful feedback but keeps warnings and errors visible", () => {
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

    onDismiss.mockClear();
    rerender(
      <AppFeedback
        feedback={{ kind: "warning", title: "Some items could not be refreshed" }}
        onDismiss={onDismiss}
      />
    );
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss message" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("animates only the status icon for global loading feedback", () => {
    const { container } = render(
      <AppFeedback
        feedback={{ kind: "loading", title: "Checking for updates" }}
        onDismiss={vi.fn()}
      />
    );

    expect(container.querySelectorAll(".is-spinning")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Copy message" }).querySelector(".is-spinning")
    ).toBeNull();
  });

  it("copies structured diagnostic details and exposes the issue reference", async () => {
    const issue = {
      reference: "AEM-20260728-ABC123",
      action: "activation:apply",
      category: "activation",
      occurredAt: "2026-07-28T12:00:00.000Z",
      durationMs: 42,
      error: {
        name: "Error",
        message: "Apply failed",
        stack: "Error: Apply failed\n at apply",
        causes: []
      },
      events: []
    };
    const api = installApi({
      readDiagnosticIssue: vi.fn().mockResolvedValue(issue)
    });
    const onViewDiagnostic = vi.fn();
    render(
      <AppFeedback
        feedback={{
          kind: "error",
          title: "Action failed",
          message: "Apply failed",
          diagnosticReference: issue.reference
        }}
        onDismiss={vi.fn()}
        onViewDiagnostic={onViewDiagnostic}
      />
    );

    expect(screen.getByText(/AEM-20260728-ABC123/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await waitFor(() =>
      expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining("Stack:"))
    );
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(onViewDiagnostic).toHaveBeenCalledWith(issue.reference);
  });

  const openProfiles = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Profiles" }));
  };

  const openLibrary = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Skills" }));
  };

  const openSettingsCategory = async (category: "General" | "Agents" | "Skills" | "Connections" | "Data") => {
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("tab", { name: category }));
  };

  const openRecoveryHistory = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    fireEvent.click(await screen.findByRole("button", { name: "More Agent actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Recovery" }));
    const dialog = await screen.findByRole("dialog", { name: "Recovery" });
    return within(dialog).getByRole("region", { name: "History" });
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
    expect(screen.queryByText("Compose reusable environments and apply them safely to local Agents.")).not.toBeInTheDocument();
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
    expect(screen.queryByText("Preview Agent: OpenCode")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current Agent OpenCode")).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "Instructions" })).toBeInTheDocument();
    const emptyMcpRow = within(composer).getByRole("button", { name: "MCPs" });
    expect(emptyMcpRow).toBeInTheDocument();
    expect(emptyMcpRow.querySelector('.profile-composer-section__count'))
      .toHaveAttribute("title", "Profile 0 · Agent 0");
    expect(within(composer).queryByRole("button", { name: "Advanced" })).not.toBeInTheDocument();
    for (const oldTab of ["Overview", "Instructions", "Config", "Resources", "Validation"]) {
      expect(screen.queryByRole("tab", { name: oldTab })).not.toBeInTheDocument();
    }

    fireEvent.click(within(composer).getByRole("button", { name: "Instructions" }));
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Agent\n");
    fireEvent.click(within(composer).getByRole("button", { name: "MCPs" }));
    expect(
      within(
        within(composer).getByRole("radiogroup", {
          name: "MCPs application policy for OpenCode"
        })
      ).getByRole("radio", { name: "Keep current" })
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTitle("Profile 0 · Agent 0")).toBeInTheDocument();
  });

  it("keeps Agents navigation available while startup discovery is pending", async () => {
    const targetRequest = deferred<TargetInfo[]>();
    installApi({
      listTargets: vi.fn().mockReturnValue(targetRequest.promise)
    });
    render(<App />);

    const navigation = screen.getByRole("complementary", { name: "Global navigation" });
    expect(
      within(navigation).getByRole("button", { name: "Agents" })
    ).toBeInTheDocument();
    expect(
      within(navigation).getByRole("region", { name: "System status" })
    ).toHaveTextContent("Detecting Agents");

    fireEvent.click(within(navigation).getByRole("button", { name: /^Quick open/ }));
    const quickOpen = screen.getByRole("dialog", { name: "Quick open" });
    fireEvent.click(within(quickOpen).getByRole("option", { name: /^Agents/ }));

    const agentsWorkspace = screen.getByRole("region", { name: "Agents" });
    expect(within(agentsWorkspace).getByRole("status")).toHaveTextContent(
      "Detecting Agents"
    );
    expect(within(agentsWorkspace).queryByText("No enabled Agents")).not.toBeInTheDocument();

    await act(async () => {
      targetRequest.resolve([target]);
      await Promise.resolve();
    });

    expect(
      await within(agentsWorkspace).findByRole("article", { name: "Agent OpenCode" })
    ).toBeInTheDocument();
    expect(within(agentsWorkspace).queryByText("Detecting Agents")).not.toBeInTheDocument();
  });

  it("refreshes Conversations in the background without changing the active workspace", async () => {
    const refreshRequest = deferred<
      Awaited<ReturnType<AgentEnvApi["refreshConversations"]>>
    >();
    const refreshConversations = vi.fn().mockReturnValue(refreshRequest.promise);
    installApi({ refreshConversations });

    render(<App />);

    expect(await screen.findByRole("region", { name: "Agents" })).toBeInTheDocument();
    await waitFor(() => expect(refreshConversations).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();

    await act(async () => {
      refreshRequest.resolve({
        indexed: 3,
        unchanged: 1,
        removed: 0,
        refreshedAt: "2026-08-01T06:00:00.000Z",
        failures: []
      });
      await refreshRequest.promise;
    });

    expect(screen.getByRole("region", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Conversations" })).not.toBeInTheDocument();
  });

  it("renders Library Skills before startup discovery and update checks finish", async () => {
    const targetRequest = deferred<TargetInfo[]>();
    const inventoryRequest = deferred<Awaited<ReturnType<AgentEnvApi["scanSkillInventory"]>>>();
    const updateRequest = deferred<Awaited<ReturnType<AgentEnvApi["checkMonitoredSkillSourceGroups"]>>>();
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
      listSkillSourceGroups: vi.fn().mockResolvedValue([{
        formatVersion: 1,
        sourceId: "source-startup",
        sourceKind: "repository",
        automaticChecks: true,
        canonicalLink: "https://github.com/acme/skills/tree/main/startup-reviewer",
        repository: "https://github.com/acme/skills.git",
        ref: "main",
        directory: "startup-reviewer",
        observationState: "ready",
        counts: { total: 1, updates: 0, new: 0, removed: 0 },
        candidates: []
      }]),
      checkMonitoredSkillSourceGroups: vi.fn().mockReturnValue(updateRequest.promise)
    });
    render(<App />);

    await openLibrary();
    expect(
      await screen.findByRole("group", { name: "Library item startup-reviewer" })
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Manage reusable Skills, their sources, updates, and local copies.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading skills")).not.toBeInTheDocument();
    expect(api.scanSkillInventory).not.toHaveBeenCalled();
    expect(api.checkMonitoredSkillSourceGroups).not.toHaveBeenCalled();

    await act(async () => {
      targetRequest.resolve([target]);
      await Promise.resolve();
    });
    await waitFor(() => expect(api.scanSkillInventory).toHaveBeenCalledTimes(1));
    expect(api.checkMonitoredSkillSourceGroups).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Skill library" })).toHaveTextContent(
      "Startup Reviewer"
    );
    expect(screen.getByRole("region", { name: "System status" })).not.toHaveTextContent(
      "Loading"
    );

    await act(async () => {
      inventoryRequest.resolve([]);
      updateRequest.resolve({ groups: [], checked: 0, failed: 0 });
      await Promise.resolve();
    });
  });

  it("keeps Agents and Profiles available when optional recovery data cannot load", async () => {
    const cleanupHistoryError =
      "Skill cleanup backup contains an unsafe path: cleanup-1784603431398-4571ea80";
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = installApi({
      listSkillCleanupBackups: vi.fn().mockRejectedValue(new Error(cleanupHistoryError)),
      listBackups: vi.fn().mockRejectedValue(new Error("Recovery history is unavailable")),
      listNativeMcpConnections: vi.fn().mockRejectedValue(
        new Error("Native MCP diagnostics are unavailable")
      )
    });
    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Agents" })
    ).toBeInTheDocument();
    await openProfiles();
    expect(
      await screen.findByRole("button", { name: /Daily Coding/ })
    ).toBeInTheDocument();
    expect(api.readProfile).toHaveBeenCalledWith("daily-coding");
    expect(screen.queryByText("Action failed")).not.toBeInTheDocument();
    expect(screen.queryByText(cleanupHistoryError)).not.toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("Cleanup history is unavailable")
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("Target recovery history is unavailable")
    );
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("Native MCP diagnostics are unavailable")
    );
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
    const api = installApi({
      listSkillLibrary,
      listSkillSourceGroups: vi.fn().mockResolvedValue([{
        formatVersion: 1,
        sourceId: "source-reviewer",
        sourceKind: "repository",
        automaticChecks: true,
        canonicalLink: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
        repository: "https://github.com/acme/agent-skills.git",
        ref: "main",
        directory: "skills/reviewer",
        observationState: "ready",
        counts: { total: 1, updates: 0, new: 0, removed: 0 },
        candidates: []
      }]),
      checkMonitoredSkillSourceGroups: vi.fn().mockResolvedValue({
        checked: 1,
        failed: 0,
        groups: [{
          formatVersion: 1,
          sourceId: "source-reviewer",
          sourceKind: "repository",
          automaticChecks: true,
          canonicalLink: "https://github.com/acme/agent-skills/tree/main/skills/reviewer",
          repository: "https://github.com/acme/agent-skills.git",
          ref: "main",
          directory: "skills/reviewer",
          observationState: "ready",
          counts: { total: 1, updates: 1, new: 0, removed: 0 },
          candidates: [{
            sourceSubpath: "",
            directory: "skills/reviewer",
            name: "GitHub Reviewer",
            description: "Review from GitHub",
            contentRevision: "revision-2",
            libraryId: "github-reviewer",
            libraryName: "GitHub Reviewer",
            globallyEnabled: true,
            updatePolicy: "tracked",
            state: "update"
          }]
        }]
      }),
      checkSkillLibraryUpdates
    });
    render(<App />);

    await openLibrary();
    expect(
      await screen.findByRole("group", {
        name: "Library item github-reviewer"
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Skill library" })
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skills" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Library item github-reviewer" }))
        .getByRole("button", { name: "Update github-reviewer" })
    ).toHaveTextContent("Update");
    expect(screen.queryByRole("complementary", { name: "Library summary" })).not.toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Activation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Profile sections" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 update available"));

    const unrelatedReads = [
      api.listTargets,
      api.listTargetStates,
      api.listProfiles,
      api.listBackups,
      api.listNativeMcpConnections,
      api.readGitHubAuthStatus
    ];
    unrelatedReads.forEach((read) => vi.mocked(read).mockClear());
    fireEvent.click(screen.getByRole("button", { name: "Refresh skills" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Skills refreshed"));
    expect(listSkillLibrary).toHaveBeenCalledTimes(2);
    expect(checkSkillLibraryUpdates).toHaveBeenCalledTimes(1);
    unrelatedReads.forEach((read) => expect(read).not.toHaveBeenCalled());
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

    await openLibrary();
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

    await openLibrary();
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

  it("clears a stale Skill update after its source check reports current content", async () => {
    const skill = {
      id: "source-reviewer",
      name: "Source Reviewer",
      description: "Review from a source group",
      path: "/tmp/skills-library/source-reviewer",
      sourceType: "git" as const,
      source: "https://github.com/acme/skills.git",
      updatePolicy: "tracked" as const,
      remoteRevision: "revision-1",
      contentHash: "hash-1",
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
    const sourceGroup = (state: "current" | "update") => ({
      formatVersion: 1 as const,
      sourceId: "source-acme",
      sourceKind: "repository" as const,
      automaticChecks: true,
      canonicalLink: "https://github.com/acme/skills/tree/main",
      repository: "https://github.com/acme/skills.git",
      ref: "main",
      directory: "",
      observationState: "ready" as const,
      counts: { total: 1, updates: state === "update" ? 1 : 0, new: 0, removed: 0 },
      candidates: [{
        sourceSubpath: "source-reviewer",
        directory: "source-reviewer",
        name: "Source Reviewer",
        description: "Review from a source group",
        contentRevision: state === "update" ? "revision-2" : "revision-1",
        libraryId: "source-reviewer",
        libraryName: "Source Reviewer",
        globallyEnabled: true,
        updatePolicy: "tracked" as const,
        state
      }]
    });
    const api = installApi({
      listSkillLibrary: vi.fn().mockResolvedValue([skill]),
      listSkillSourceGroups: vi.fn().mockResolvedValue([sourceGroup("update")]),
      checkMonitoredSkillSourceGroups: vi.fn().mockResolvedValue({
        groups: [sourceGroup("update")],
        checked: 1,
        failed: 0
      }),
      checkSkillSourceGroup: vi.fn().mockResolvedValue(sourceGroup("current"))
    });
    render(<App />);

    await openLibrary();
    const row = await screen.findByRole("group", { name: "Library item source-reviewer" });
    await waitFor(() => expect(
      within(row).getByRole("button", { name: "Update source-reviewer" })
    ).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "By source" }));
    await screen.findByText("Source Reviewer", { exact: true });
    const sourceGroupRow = document.querySelector<HTMLElement>(".skill-source-group");
    if (!sourceGroupRow) throw new Error("Source group did not render");
    fireEvent.click(within(sourceGroupRow).getByRole("button", {
      name: "Source actions for acme/skills"
    }));
    const checkButton = screen.getByRole("menuitem", { name: "Check source" });
    await waitFor(() => expect(checkButton).toBeEnabled());
    fireEvent.click(checkButton);
    await waitFor(() => expect(api.checkSkillSourceGroup).toHaveBeenCalledWith("source-acme"));
    fireEvent.click(screen.getByRole("tab", { name: "Skill list" }));
    await waitFor(() => expect(
      within(row).queryByRole("button", { name: "Update source-reviewer" })
    ).toBeNull());
  });

  it("checks only monitored source groups from the By source toolbar", async () => {
    const sourceGroup = {
      formatVersion: 1 as const,
      sourceId: "source-acme",
      sourceKind: "repository" as const,
      automaticChecks: true,
      canonicalLink: "https://github.com/acme/skills/tree/main",
      repository: "https://github.com/acme/skills.git",
      ref: "main",
      directory: "",
      observationState: "ready" as const,
      counts: { total: 1, updates: 0, new: 0, removed: 0 },
      candidates: []
    };
    const manualSourceGroup = {
      ...sourceGroup,
      sourceId: "source-local",
      sourceKind: "local" as const,
      automaticChecks: false,
      canonicalLink: "file:///tmp/old-skills",
      repository: "/tmp/old-skills",
      ref: "",
      counts: { total: 1, updates: 1, new: 0, removed: 0 }
    };
    const checkMonitored = vi.fn().mockResolvedValue({
      groups: [sourceGroup, manualSourceGroup],
      checked: 1,
      failed: 0
    });
    const api = installApi({
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: false,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null
      }),
      listSkillSourceGroups: vi.fn().mockResolvedValue([sourceGroup, manualSourceGroup]),
      checkMonitoredSkillSourceGroups: checkMonitored
    });
    render(<App />);

    await openLibrary();
    fireEvent.click(await screen.findByRole("tab", { name: "By source" }));
    const checkButton = await screen.findByRole("button", { name: "Check updates" });
    fireEvent.click(checkButton);

    await waitFor(() => expect(checkMonitored).toHaveBeenCalledTimes(1));
    await screen.findByText("Monitored sources are current");
    expect(api.checkMonitoredSkillSourceGroups).toBe(checkMonitored);
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

    await openLibrary();
    const localRow = await screen.findByRole("group", { name: "Library item local-reviewer" });
    const unrelatedReads = [
      api.listTargets,
      api.listTargetStates,
      api.listProfiles,
      api.listBackups,
      api.listSkillLibrary,
      api.scanSkillInventory
    ];
    unrelatedReads.forEach((read) => vi.mocked(read).mockClear());
    vi.mocked(api.checkSkillLibraryUpdates).mockClear();

    fireEvent.click(within(localRow).getByRole("button", { name: "More actions for local-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
    const trackingSwitch = screen.getByRole("switch", {
      name: "Track updates for local-reviewer"
    });
    fireEvent.click(trackingSwitch);
    expect(api.setSkillUpdateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(api.setSkillUpdateSettings).toHaveBeenCalledWith({
        policy: {
          id: "local-reviewer",
          policy: "untracked"
        }
      })
    );
    expect(screen.queryByRole("dialog", { name: "Update settings for local-reviewer" }))
      .not.toBeInTheDocument();
    fireEvent.click(within(localRow).getByRole("button", { name: "More actions for local-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update settings" }));
    const restoredTrackingSwitch = screen.getByRole("switch", {
      name: "Track updates for local-reviewer"
    });
    await waitFor(() => expect(restoredTrackingSwitch).toHaveAttribute("aria-checked", "false"));
    fireEvent.click(restoredTrackingSwitch);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() =>
      expect(api.setSkillUpdateSettings).toHaveBeenCalledWith({
        policy: {
          id: "local-reviewer",
          policy: "tracked"
        }
      })
    );
    await waitFor(() =>
      expect(api.checkSkillLibraryUpdates).toHaveBeenCalledWith(["local-reviewer"])
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change icon for local-reviewer" })
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Code" }));
    await waitFor(() =>
      expect(api.setSkillIcon).toHaveBeenCalledWith({ id: "local-reviewer", iconKey: "code" })
    );
    unrelatedReads.forEach((read) => expect(read).not.toHaveBeenCalled());
  });

  it("forces a local scan both when opening Local Skills and from its toolbar", async () => {
    const api = installApi({
      scanSkillInventory: vi.fn().mockResolvedValueOnce([
        {
          id: "target-only-reviewer",
          name: "Target Only Reviewer",
          description: "Found on disk",
          path: "/tmp/opencode/skills/target-only-reviewer",
          foundIn: ["opencode"],
          status: "outside"
        }
      ]).mockResolvedValueOnce([
        {
          id: "refreshed-reviewer",
          name: "Refreshed Reviewer",
          description: "Found after rescanning",
          path: "/tmp/opencode/skills/refreshed-reviewer",
          foundIn: ["opencode"],
          status: "outside"
        }
      ]).mockResolvedValueOnce([
        {
          id: "toolbar-reviewer",
          name: "Toolbar Reviewer",
          description: "Found from the toolbar refresh",
          path: "/tmp/opencode/skills/toolbar-reviewer",
          foundIn: ["opencode"],
          status: "outside"
        }
      ])
    });
    render(<App />);

    await openLibrary();
    await screen.findByRole("region", { name: "Skill library" });
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "More Skill actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Scan local" }));

    expect(await screen.findByRole("region", { name: "Environment skills" })).toBeInTheDocument();
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("group", { name: "Cleanup group refreshed-reviewer" })
    ).toHaveTextContent("Found after rescanning");

    fireEvent.click(screen.getByRole("button", { name: "Refresh local skills" }));
    expect(
      await screen.findByRole("group", { name: "Cleanup group toolbar-reviewer" })
    ).toHaveTextContent("Found from the toolbar refresh");
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent("Local skills refreshed");
  });

  it("automatically rescans Local Skills on entry after the freshness window", async () => {
    let now = Date.parse("2026-07-29T10:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const api = installApi({
      scanSkillInventory: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{
          id: "new-local-skill",
          name: "New Local Skill",
          description: "Appeared after startup",
          path: "/tmp/opencode/skills/new-local-skill",
          foundIn: ["opencode"],
          status: "outside"
        }])
    });
    render(<App />);

    await openLibrary();
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(1);
    now += 60_001;
    fireEvent.click(screen.getByRole("button", { name: /^Agents$/ }));
    await openLibrary();
    await waitFor(() => expect(api.scanSkillInventory).toHaveBeenCalledTimes(2));
  });

  it("checks monitored Skill sources when their persisted due time arrives", async () => {
    let now = Date.parse("2026-07-29T10:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let dueCallback: (() => void) | undefined;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(
      (callback, timeout) => {
        if (timeout === 3 * 60 * 1000) {
          dueCallback = callback as () => void;
        }
        return 1 as unknown as ReturnType<typeof window.setTimeout>;
      }
    );
    const sourceGroup = (checkedAt: string) => ({
      formatVersion: 1 as const,
      sourceId: "source-acme",
      sourceKind: "repository" as const,
      automaticChecks: true,
      canonicalLink: "https://github.com/acme/skills/tree/main",
      repository: "https://github.com/acme/skills.git",
      ref: "main",
      directory: "",
      checkedAt,
      observationState: "ready" as const,
      counts: { total: 0, updates: 0, new: 0, removed: 0 },
      candidates: []
    });
    const api = installApi({
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        skillSyncMethod: "symlink",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 5
      }),
      listSkillSourceGroups: vi.fn().mockResolvedValue([
        sourceGroup(new Date(now - 2 * 60 * 1000).toISOString())
      ]),
      checkMonitoredSkillSourceGroups: vi.fn().mockResolvedValue({
        groups: [sourceGroup(new Date(now).toISOString())],
        checked: 1,
        failed: 0
      })
    });
    render(<App />);

    await act(async () => {
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    });
    expect(api.checkMonitoredSkillSourceGroups).not.toHaveBeenCalled();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3 * 60 * 1000);
    expect(dueCallback).toBeDefined();

    await act(async () => {
      dueCallback?.();
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    });
    expect(api.checkMonitoredSkillSourceGroups).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000 + 1;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      for (let index = 0; index < 10; index += 1) {
        await Promise.resolve();
      }
    });
    expect(api.checkMonitoredSkillSourceGroups).toHaveBeenCalledTimes(2);
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

    await openSettingsCategory("Connections");
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

    await openSettingsCategory("Skills");

    const syncMethod = screen.getByLabelText("Global skill deployment method");
    expect(syncMethod).toHaveValue("symlink");
    expect(
      within(syncMethod).getByRole("option", { name: "Live link (recommended)" })
    ).toBeInTheDocument();
  });

  it("switches and persists the interface language from Settings", async () => {
    const api = installApi();
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const unrelatedReads = [
      api.listTargets,
      api.listTargetStates,
      api.listProfiles,
      api.listBackups,
      api.listSkillLibrary,
      api.scanSkillInventory
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

  it("moves between Settings categories with desktop tab keyboard controls", async () => {
    installApi();
    render(<App />);

    await openSettingsCategory("General");
    const generalTab = screen.getByRole("tab", { name: "General" });
    generalTab.focus();
    fireEvent.keyDown(generalTab, { key: "ArrowRight" });

    const agentsTab = screen.getByRole("tab", { name: "Agents" });
    expect(agentsTab).toHaveFocus();
    expect(agentsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("locale-select")).not.toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Turn off OpenCode" })).toBeInTheDocument();

    fireEvent.keyDown(agentsTab, { key: "End" });
    const dataTab = screen.getByRole("tab", { name: "Data" });
    expect(dataTab).toHaveFocus();
    expect(dataTab).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Data & Backups")).toBeInTheDocument();

    fireEvent.keyDown(dataTab, { key: "Home" });
    expect(generalTab).toHaveFocus();
    expect(generalTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("locale-select")).toBeInTheDocument();
  });

  it("offers copy, export, and log-folder diagnostics from Data settings", async () => {
    const exportRequest = deferred<string | undefined>();
    const api = installApi({
      readLatestDiagnosticIssue: vi.fn().mockResolvedValue({
        reference: "AEM-20260728-ABC123",
        action: "skills:scan-inventory",
        category: "skills",
        occurredAt: "2026-07-28T12:00:00.000Z",
        error: {
          name: "Error",
          message: "Inventory failed",
          causes: []
        },
        events: []
      }),
      exportDiagnostics: vi.fn().mockReturnValue(exportRequest.promise)
    });
    render(<App />);

    await openSettingsCategory("Data");
    expect(await screen.findByText("Diagnostics")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy latest issue" }));
    await waitFor(() =>
      expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining("Inventory failed"))
    );
    const exportButton = screen.getByRole("button", { name: "Export report" });
    fireEvent.click(exportButton);
    await waitFor(() => expect(api.exportDiagnostics).toHaveBeenCalledWith());
    expect(exportButton).toHaveAttribute("aria-busy", "true");
    expect(exportButton.querySelector(".is-spinning")).not.toBeNull();
    act(() => exportRequest.resolve("/tmp/diagnostics.json"));
    const exported = await screen.findByRole("status");
    expect(exportButton).toHaveAttribute("aria-busy", "false");
    expect(exported).toHaveClass("app-feedback--success");
    expect(exported).toHaveTextContent(
      "Diagnostic report exported to /tmp/diagnostics.json"
    );
    expect(exported.querySelector(".is-spinning")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open logs" }));
    expect(api.openDiagnosticsFolder).toHaveBeenCalledTimes(1);
  });

  it("persists the terminal used to open conversations", async () => {
    const api = installApi();
    render(<App />);

    await openSettingsCategory("General");
    fireEvent.change(screen.getByTestId("conversation-terminal-select"), {
      target: { value: "ghostty" }
    });

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({ conversationTerminal: "ghostty" })
    );
    expect(screen.getByTestId("conversation-terminal-select")).toHaveValue("ghostty");
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
        conversationTerminal: "default" as const,
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
        conversationTerminal: "default",
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

    await openSettingsCategory("Agents");
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
    const agentsNavigation = screen.getByRole("button", { name: "Agents" });
    expect(agentsNavigation).toBeInTheDocument();
    fireEvent.click(agentsNavigation);
    expect(
      await screen.findByRole("region", { name: "Agents" })
    ).toHaveTextContent("No enabled Agents");

    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
    await screen.findByRole("region", { name: "Profiles" });
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(api.listSupportedTargets).toHaveBeenCalled();
  });

  it("confirms before turning off a managed Agent", async () => {
    let enabledTargetIds = ["opencode"];
    const settingsUpdate = deferred<AgentEnvSettings>();
    const updateSettings = vi.fn((input: Partial<AgentEnvSettings>) => {
      enabledTargetIds = input.enabledTargetIds ?? enabledTargetIds;
      return settingsUpdate.promise;
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

    await openSettingsCategory("Agents");
    const agentSwitch = screen.getByRole("switch", { name: "Turn off OpenCode" });
    agentSwitch.focus();
    fireEvent.click(agentSwitch);

    const dialog = screen.getByRole("dialog", { name: "Turn off OpenCode?" });
    expect(dialog).toHaveTextContent("Existing managed files stay in place");
    expect(dialog).toHaveTextContent("turn this Agent on again before changing or recovering them");
    expect(updateSettings).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off OpenCode" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ enabledTargetIds: [] }));
    expect(screen.getByText("Saving...")).toBeInTheDocument();
    act(() => settingsUpdate.resolve({
      locale: "system",
      conversationTerminal: "default",
      skillSyncMethod: "symlink",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null,
      enabledTargetIds
    }));
    await waitFor(() => expect(screen.queryByText("Saving...")).not.toBeInTheDocument());
    await waitFor(() => expect(agentSwitch).toHaveFocus());
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

    await openSettingsCategory("Agents");

    expect(await screen.findByText("Recovery required")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Turn off OpenCode" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open Recovery" }));
    expect(await screen.findByRole("region", { name: "Agents" })).toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("keeps MCP definitions out of Library and saves target-native activation choices", async () => {
    const api = installApi({
      listNativeMcpConnections: vi.fn().mockResolvedValue({ connections: [
        {
          targetId: "opencode",
          name: "context7",
          scope: "user",
          transport: "http",
          enabled: true,
          controllable: true,
          sourcePath: "/tmp/home/.config/opencode/opencode.jsonc"
        }
      ], issues: [] })
    });
    render(<App />);

    await openLibrary();
    await screen.findByRole("region", { name: "Skill library" });
    expect(
      within(screen.getByRole("navigation", { name: "Workspace" })).queryByRole(
        "button",
        { name: "MCPs" }
      )
    ).not.toBeInTheDocument();
    await openProfiles();
    fireEvent.click(
      within(
        screen.getByRole("region", { name: "Profile composer" })
      ).getByRole("button", { name: "MCPs" })
    );
    fireEvent.click(
      within(
        await screen.findByRole("radiogroup", {
          name: "MCPs application policy for OpenCode"
        })
      ).getByRole("radio", { name: "Use Profile" })
    );
    const behavior = await screen.findByLabelText("context7 Profile behavior");
    expect(within(behavior).getByRole("radio", { name: "Agent" })).toBeChecked();
    expect(within(behavior).getByRole("radio", { name: "On" })).toBeInTheDocument();
    expect(within(behavior).getByRole("radio", { name: "Off" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
    expect(
      vi.mocked(api.saveProfile).mock.calls.at(-1)?.[0].resources.mcpByTarget.opencode
    ).toEqual({ mode: "manage", selections: [] });
    vi.mocked(api.saveProfile).mockClear();

    fireEvent.click(within(behavior).getByRole("radio", { name: "Off" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
    expect(
      vi.mocked(api.saveProfile).mock.calls.at(-1)?.[0].resources.mcpByTarget.opencode
    ).toEqual({
      mode: "manage",
      selections: [{ name: "context7", enabled: false }]
    });
  });

  it("shows native MCP inspection failures instead of a false empty state", async () => {
    installApi({
      readProfile: vi.fn().mockResolvedValue({
        ...profile,
        resources: {
          ...profile.resources,
          mcpByTarget: {
            opencode: { mode: "manage", selections: [] }
          }
        }
      }),
      listNativeMcpConnections: vi.fn().mockResolvedValue({
        connections: [],
        issues: [{
          targetId: "opencode",
          targetName: "OpenCode",
          sourcePath: "/tmp/home/.config/opencode/opencode.jsonc",
          message: "Invalid live opencode.jsonc"
        }]
      })
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(
      within(screen.getByRole("region", { name: "Profile composer" }))
        .getByRole("button", { name: "MCPs" })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not inspect MCP connections"
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid live opencode.jsonc");
    expect(
      screen.queryByText("No MCP connections are configured in OpenCode.")
    ).not.toBeInTheDocument();
  });

  it("shows read-only native MCPs without offering Profile activation controls", async () => {
    const readOnlyTarget: TargetInfo = {
      ...target,
      id: "claude-code",
      name: "Claude Code",
      capabilities: { ...target.capabilities, mcpActivation: false },
      paths: {
        ...target.paths,
        targetId: "claude-code",
        configDir: "/tmp/home/.claude",
        configPath: "/tmp/home/.claude/settings.json",
        mcpConfigPath: "/tmp/home/.claude.json"
      }
    };
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([readOnlyTarget]),
      listTargets: vi.fn().mockResolvedValue([readOnlyTarget]),
      listNativeMcpConnections: vi.fn().mockResolvedValue({ connections: [
        {
          targetId: "claude-code",
          name: "docs",
          scope: "user",
          transport: "stdio",
          enabled: true,
          controllable: false,
          sourcePath: "/tmp/home/.claude.json"
        }
      ], issues: [] }),
      readProfile: vi.fn().mockResolvedValue({
        ...profile,
        manifest: { ...profile.manifest, preferredTargetId: "claude-code" }
      })
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(
      within(
        screen.getByRole("region", { name: "Profile composer" })
      ).getByRole("button", { name: "MCPs" })
    );
    const agentControlled = await screen.findByText("Agent controlled");
    expect(agentControlled).toBeInTheDocument();
    const section = agentControlled.closest(".profile-composer-section");
    expect(section).toHaveClass("is-agent-controlled");
    expect(section).not.toHaveClass("is-unmanaged");
    expect(
      screen.queryByLabelText("docs Profile behavior")
    ).not.toBeInTheDocument();
  });

  it("keeps ambiguous MCP definitions Agent-controlled on an otherwise manageable Agent", async () => {
    installApi({
      listNativeMcpConnections: vi.fn().mockResolvedValue({ connections: [
        {
          targetId: "opencode",
          name: "docs",
          scope: "user",
          transport: "stdio",
          enabled: true,
          controllable: false,
          sourcePath: "/tmp/home/.config/opencode/a.json · /tmp/home/.config/opencode/b.json",
          detail: "duplicate-user-sources"
        }
      ], issues: [] }),
      readProfile: vi.fn().mockResolvedValue({
        ...profile,
        resources: {
          ...profile.resources,
          mcpByTarget: {
            opencode: {
              mode: "manage",
              selections: [{ name: "docs", enabled: true }]
            }
          }
        }
      })
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(
      within(screen.getByRole("region", { name: "Profile composer" }))
        .getByRole("button", { name: "MCPs" })
    );

    const row = (await screen.findByText("docs", {
      selector: ".profile-mcp-name"
    })).closest(".profile-mcp-row");
    expect(row).toHaveTextContent("Defined in multiple Agent files · Agent controlled");
    expect(screen.queryByLabelText("docs Profile behavior")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove override" }));
    expect(screen.getByText("Agent controlled")).toBeInTheDocument();
  });

  it("refreshes target discovery from the Targets page", async () => {
    const refreshedTarget = {
      ...target,
      health: {
        ...target.health,
        status: "missing" as const,
        installationFound: false,
        installationEvidence: [],
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
        .mockResolvedValue([refreshedTarget]),
      listNativeMcpConnections: vi.fn()
        .mockResolvedValueOnce({ connections: [], issues: [] })
        .mockRejectedValueOnce(new Error("Optional MCP diagnostics unavailable"))
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    expect(await screen.findByRole("article", { name: "Agent OpenCode" })).toHaveTextContent("Ready");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(api.listTargets).toHaveBeenCalledTimes(2));
    expect(api.listTargets).toHaveBeenLastCalledWith(true);
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Agent OpenCode" })).toHaveTextContent("Missing")
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Agents refreshed");
    expect(screen.getByText("Updated with issues")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dismiss message" })).not.toBeInTheDocument();
  });

  it("rechecks Agent discovery on focus only after its freshness window", async () => {
    let now = Date.parse("2026-07-29T10:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const api = installApi();
    render(<App />);

    await screen.findByRole("article", { name: "Agent OpenCode" });
    expect(api.listTargets).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(api.listTargets).toHaveBeenCalledTimes(1);

    now += 5 * 60 * 1000 + 1;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    await waitFor(() => expect(api.listTargets).toHaveBeenCalledTimes(2));
    expect(api.listTargets).toHaveBeenLastCalledWith(true);
  });

  it("opens full Agent capture from its name and explains unavailable setup", async () => {
    const unavailableTarget = {
      ...target,
      health: {
        ...target.health,
        status: "missing" as const,
        installationFound: false,
        installationEvidence: [],
        executableFound: false,
        executablePath: undefined,
        canWrite: false,
        summary: "opencode CLI not found"
      }
    };
    installApi({
      listTargets: vi.fn().mockResolvedValue([unavailableTarget]),
      listTargetStates: vi.fn().mockResolvedValue([])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    const targetCard = await screen.findByRole("article", { name: "Agent OpenCode" });
    fireEvent.click(within(targetCard).getByRole("button", { name: "OpenCode" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Create profile from OpenCode"
    });
    expect(dialog).toHaveTextContent("Installation not detected");
    expect(within(dialog).getByRole("button", { name: "Review" })).toBeDisabled();
  });

  it("opens at most one composer section and allows all sections to collapse", async () => {
    installApi({
      readProfile: vi.fn().mockResolvedValue(richProfile)
    });
    render(<App />);

    await openProfiles();
    const composer = await screen.findByRole("region", { name: "Profile composer" });
    expect(
      screen.getByLabelText(
        "Compose reusable resources, then preview and apply them to an Agent."
      )
    ).toBeInTheDocument();
    const instructions = within(composer).getByRole("button", { name: "Instructions" });
    const skills = within(composer).getByRole("button", { name: "Skills" });
    const mcp = within(composer).getByRole("button", { name: "MCPs" });

    expect(instructions).toHaveAccessibleDescription(/1.*AGENTS\.md/);
    expect(skills).toHaveAccessibleDescription(
      /2.*library-testing.*library-docs/
    );
    expect(mcp).toHaveAccessibleDescription(
      /Profile 4 · Agent 0.*library-docs.*shared-mcp.*raw-browser/
    );
    expect(skills).toHaveAttribute("aria-expanded", "false");
    expect(instructions).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(mcp);
    expect(mcp).toHaveAttribute("aria-expanded", "true");
    expect(skills).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(mcp);
    expect(mcp).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps usable Profiles available and surfaces a damaged stored Profile", async () => {
    const readProfile = vi.fn().mockImplementation(async (profileId) => {
      if (profileId === "broken-profile") throw new Error("Invalid profile manifest");
      return profile;
    });
    installApi({
      listProfiles: vi.fn().mockResolvedValue([
        summaryOf(profile),
        {
          id: "broken-profile",
          targetId: "unknown",
          name: "broken-profile",
          description: "This Profile could not be loaded",
          loadError: "Invalid profile manifest"
        }
      ]),
      readProfile
    });
    render(<App />);

    await openProfiles();
    expect(await screen.findByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    const brokenRow = screen.getByRole("group", { name: "Profile broken-profile" });
    expect(brokenRow).toHaveTextContent("Stored Profile data could not be loaded");

    fireEvent.click(within(brokenRow).getByRole("button"));

    expect(readProfile).not.toHaveBeenCalledWith("broken-profile");
    expect(await screen.findByText(/broken-profile needs repair: Invalid profile manifest/))
      .toBeInTheDocument();
  });

  it("focuses the active profile without moving it ahead of newer profiles", async () => {
    const activeProfile: ProfileDetail = {
      ...richProfile,
      resources: {
        ...richProfile.resources,
        skills: [
          { libraryId: "testing", targetName: "library-testing", enabled: true },
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
          resources: expect.objectContaining({
            skills: [
              { libraryId: "testing", targetName: "library-testing", enabled: false },
              { libraryId: "docs", targetName: "library-docs", enabled: false }
            ]
          })
        })
      )
    );
  });

  it("keeps profile rows focused on identity and deployment state", async () => {
    installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      readProfile: vi.fn().mockResolvedValue(richProfile),
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({
          lastAppliedAt: "2026-07-09T08:00:00.000Z",
          appliedLibraryVersions: {
            skills: { docs: "missing", testing: "missing" }
          }
        }),
        managedState({
          targetId: "codex",
          lastAppliedAt: "2026-07-10T08:00:00.000Z",
          appliedLibraryVersions: {
            skills: { docs: "missing", testing: "missing" }
          }
        })
      ])
    });
    render(<App />);

    await openProfiles();
    const profileList = screen.getByRole("complementary", { name: "Profile list" });
    const row = within(profileList).getByRole("button", { name: /Daily Coding/ });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row).not.toHaveTextContent("2 skills");
    expect(row).not.toHaveTextContent("3 MCP");
    expect(row).not.toHaveTextContent("1 file");
    expect(row).not.toHaveTextContent("Default developer environment");
    expect(within(row).getByLabelText("Codex · Active, OpenCode · Active")).toBeInTheDocument();
    expect(row).toHaveTextContent("2 Agents · Active");
    expect(document.querySelector(".profile-hero")).not.toHaveTextContent("Applied Jul 9");

    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Updated Agent\n" }
    });
    expect(row).toHaveTextContent("Unsaved");
    expect(row.querySelector(".profile-row__dirty")).toHaveTextContent("Unsaved");
    expect(document.querySelector(".app-feedback")).toBeNull();
  });

  it("keeps the only New Profile action with the Profile list", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    const newProfileButtons = screen.getAllByRole("button", { name: "New Profile" });
    expect(newProfileButtons).toHaveLength(1);
    expect(newProfileButtons[0].closest(".profile-index-header")).not.toBeNull();

    const edit = screen.getByRole("button", { name: "Edit profile" });
    const more = screen.getByRole("button", { name: "More profile actions" });
    expect(edit).toHaveAttribute("title", "Edit profile");
    expect(more).toHaveAttribute("title", "More profile actions");
    expect(more.closest(".profile-hero")).not.toBeNull();
    expect(more.closest(".profile-index-header")).toBeNull();
    expect(screen.getByLabelText("Current Agent OpenCode")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select apply Agent" })).not.toBeInTheDocument();
  });

  it("opens the shared Profile actions from a list-row context menu", async () => {
    const api = installApi({
      listProfiles: vi.fn().mockResolvedValue([summaryOf(profile), summaryOf(profileB)]),
      readProfile: vi.fn().mockImplementation(async (profileId) =>
        profileId === profileB.id ? profileB : profile
      )
    });
    render(<App />);

    await openProfiles();
    const row = screen.getByRole("group", { name: "Profile Profile B" });
    fireEvent.contextMenu(row, { clientX: 280, clientY: 220 });
    const menu = screen.getByRole("menu", { name: "Profile actions" });
    expect(menu).toHaveClass("profile-row-context-menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete profile" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete profile" });
    expect(dialog).toHaveTextContent("Remove Profile B?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove profile" }));
    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("profile-b"));
    expect(screen.getByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
  });

  it("keeps Compare with Apply in the selected Profile action group", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    const hero = document.querySelector(".profile-hero");
    expect(hero).not.toBeNull();
    const actions = within(hero as HTMLElement).getByRole("group", {
      name: "Selected profile actions"
    });
    const actionLabels = within(actions)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());

    expect(actionLabels.slice(0, 3)).toEqual(["Save", "Compare", "Apply"]);
    const saveButton = within(actions).getByRole("button", { name: "Save" });
    const compareButton = within(actions).getByRole("button", { name: "Compare" });
    const applyButton = within(actions).getByRole("button", { name: "Apply" });
    expect(compareButton.nextElementSibling?.contains(applyButton)).toBe(true);
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
    expect(within(row).queryByRole("button", {
      name: "Change icon for profile daily-coding"
    })).not.toBeInTheDocument();
    const icon = within(document.querySelector(".profile-hero") as HTMLElement).getByRole("button", {
      name: "Change icon for profile daily-coding"
    });
    expect(icon).toHaveAttribute("data-icon", "layers");
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
        expectedContentHash: "profile-hash",
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

  it("rechecks a cached unavailable Agent before blocking Apply", async () => {
    const unavailableTarget: TargetInfo = {
      ...target,
      health: {
        ...target.health,
        status: "missing",
        installationFound: false,
        installationEvidence: [],
        executablePath: undefined,
        executableFound: false,
        canWrite: false,
        summary: "opencode CLI not found"
      }
    };
    const listTargets = vi
      .fn()
      .mockResolvedValueOnce([unavailableTarget])
      .mockResolvedValue([target]);
    const api = installApi({ listTargets });
    render(<App />);

    await openProfiles();
    const applyButton = screen.getByRole("button", { name: "Apply" });
    expect(screen.getByRole("status", { name: "Profile readiness" }))
      .toHaveTextContent("OpenCode unavailable");

    fireEvent.click(applyButton);

    await waitFor(() => expect(listTargets).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    const dialog = await screen.findByRole("dialog", { name: "Preview" });
    expect(dialog).not.toHaveTextContent("opencode CLI not found");
    expect(within(dialog).getByRole("button", { name: /^Apply$/ })).toBeEnabled();
  });

  it("opens Compare only for a saved Profile and disables it while the draft is dirty", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    const compareButton = screen.getByRole("button", { name: "Compare" });
    const applyButton = screen.getByRole("button", { name: "Apply" });
    const profileActions = screen.getByRole("group", { name: "Selected profile actions" });
    expect(profileActions).toContainElement(compareButton);
    expect(compareButton.nextElementSibling).toContainElement(applyButton);
    expect(compareButton).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Unsaved evaluation draft\n" }
    });

    expect(compareButton).toBeDisabled();
    expect(compareButton).toHaveAttribute(
      "title",
      "Save this Profile before comparing it"
    );
    expect(screen.queryByRole("dialog", { name: /Compare Daily Coding/ }))
      .not.toBeInTheDocument();
  });

  it("keeps isolated comparison unavailable when the platform write sandbox is unsupported", async () => {
    installApi({ platform: "win32" });
    render(<App />);

    await openProfiles();
    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();
    expect(compareButton).toHaveAttribute(
      "title",
      "Isolated comparison currently requires macOS"
    );
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

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    fireEvent.keyDown(document, { key: "s", metaKey: true });

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

    fireEvent.keyDown(document, { key: "s", metaKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent("Profile storage is read-only");
    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(instructions).toHaveValue("# Shortcut draft\n");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("ignores the whole-Profile save shortcut when the draft is clean", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.keyDown(document, { key: "s", metaKey: true });

    expect(api.saveProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
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
      .toBeNull();
    expect(screen.getByRole("button", { name: "Apply" }).querySelector("svg"))
      .not.toBeNull();
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
    expect(screen.getByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    expect(profileOrder()).toEqual(["Codex Review", "Daily Coding"]);

    fireEvent.click(within(profileList).getByRole("button", { name: /Codex Review/ }));
    await waitFor(() => expect(api.readProfile).toHaveBeenCalledWith("codex-review"));
    expect(await screen.findByRole("heading", { name: "Codex Review" })).toBeInTheDocument();
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
    expect(screen.getByRole("status", { name: "Loading profile Profile C" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

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
    expect(screen.getByRole("status", { name: "Loading profile Profile C" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

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
    expect(within(dialog).getByRole("button", { name: /^Apply$/ })).toBeEnabled();
    expect(readyApi.applyProfile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    cleanup();
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({
          activeProfileId: "another-profile",
          managedResourceCount: 7
        })
      ])
    });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Ready for OpenCode");
    action = document.querySelector<HTMLButtonElement>(".profile-apply-button")!;
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
    expect(within(dialog).getByRole("button", { name: /^Apply$/ })).toBeDisabled();

    cleanup();
    const invalidProfile = {
      ...profile,
      instructions: ""
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
    expect(within(dialog).getByRole("button", { name: /^Apply$/ })).toBeEnabled();

    cleanup();
    const driftIssue: ApplyIssue = {
      id: "managed-resource-drift:review",
      code: "managed-resource-drift",
      disposition: "review",
      resolution: "backup-replace",
      resourceKind: "skill",
      resourceId: "review",
      path: "/tmp/home/.config/opencode/skills/review",
      message: "AgentEnv-managed skill review changed outside AgentEnv"
    };
    const driftApi = installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({ activeProfileId: "another-profile" })
      ]),
      previewApply: vi.fn().mockResolvedValue({ ...preview, issues: [driftIssue] })
    });
    render(<App />);
    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(driftApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    action = document.querySelector<HTMLButtonElement>(".profile-apply-button")!;
    expect(action).toHaveAttribute("title", "Preview & apply to OpenCode");
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Review protected changes on OpenCode");
    expect(screen.queryByRole("button", { name: "Review preview" })).not.toBeInTheDocument();
    dialog = screen.getByRole("dialog", { name: "Preview" });
    expect(dialog).toHaveTextContent("Skill review changed outside AgentEnv");
    expect(dialog).not.toHaveTextContent("OpenCode skill changed outside AgentEnv");
    const replaceButton = within(dialog).getByRole("button", { name: /^Apply$/ });
    expect(replaceButton).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Open recovery history" })).toBeInTheDocument();
    fireEvent.click(replaceButton);
    await waitFor(() =>
      expect(driftApi.applyProfile).toHaveBeenCalledWith("daily-coding", "preview-1")
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

  it("refreshes a stale Apply preview in place and requires confirmation again", async () => {
    const refreshedPreview: ActivationPreview = {
      ...preview,
      id: "preview-2",
      changes: preview.changes.map((change) => ({
        ...change,
        before: "# Changed while reviewing\n"
      }))
    };
    const api = installApi({
      previewApply: vi
        .fn()
        .mockResolvedValueOnce(preview)
        .mockResolvedValueOnce(refreshedPreview),
      applyProfile: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          kind: "stale",
          errors: ["Agent changed after preview"]
        })
        .mockResolvedValueOnce({ ok: true, backupId: "backup-2" })
    });
    render(<App />);
    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    let dialog = await screen.findByRole("dialog", { name: "Preview" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Apply$/ }));

    await waitFor(() => expect(api.previewApply).toHaveBeenCalledTimes(2));
    expect(api.applyProfile).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("The Agent changed while Preview was open. Preview refreshed."))
      .toBeInTheDocument();
    expect(screen.getByText("Agent changed after preview")).toBeInTheDocument();
    dialog = screen.getByRole("dialog", { name: "Preview" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Apply$/ }));

    await waitFor(() =>
      expect(api.applyProfile).toHaveBeenLastCalledWith("daily-coding", "preview-2")
    );
  });

  it("routes recovery readiness to the backup manager", async () => {
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
    expect(await screen.findByRole("dialog", { name: "Manage Backups" })).toBeInTheDocument();
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

    await screen.findByRole("region", { name: "Agents" });

    const openCodeCard = await screen.findByRole("article", { name: "Agent OpenCode" });
    expect(within(openCodeCard).getByText("Applied")).toBeInTheDocument();
    expect(within(openCodeCard).getByText("Daily Coding")).toBeInTheDocument();
  });

  it("opens an Agent's active Profile in the canonical full editor", async () => {
    const managedProfile: ProfileDetail = {
      ...profile,
      instructions: "Use the reviewed workflow.",
      resources: {
        skills: [
          { libraryId: "review-workflow", targetName: "review-workflow", enabled: true }
        ],
        mcpByTarget: {
          opencode: {
            mode: "manage",
            selections: [{ name: "filesystem", enabled: true }]
          }
        }
      }
    };
    installApi({
      readProfile: vi.fn().mockResolvedValue(managedProfile),
      listTargetStates: vi.fn().mockResolvedValue([
        managedState()
      ])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    const targetCard = await screen.findByRole("article", { name: "Agent OpenCode" });
    fireEvent.click(
      within(targetCard).getByRole("button", { name: "Configure OpenCode" })
    );

    await screen.findByRole("region", { name: "Profiles" });
    const composer = screen.getByRole("region", { name: "Profile composer" });
    expect(within(composer).getByRole("button", { name: "Instructions" })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "Skills" })).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "MCPs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });

  it("keeps the invoking Agent selected when opening a shared Profile", async () => {
    installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({ targetId: "codex" })
      ]),
      readProfile: vi.fn().mockResolvedValue(profile)
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    const targetCard = await screen.findByRole("article", { name: "Agent Codex" });
    fireEvent.click(
      within(targetCard).getByRole("button", { name: "Configure Codex" })
    );

    await screen.findByRole("region", { name: "Profiles" });
    fireEvent.click(screen.getByRole("button", { name: "Select apply Agent" }));
    const menu = screen.getByRole("menu", { name: "Apply Agents" });
    expect(
      within(menu).getByRole("menuitemradio", { name: "Codex" })
    ).toHaveAttribute("aria-checked", "true");
  });

  it("starts an unmanaged Agent through complete Profile capture", async () => {
    const capturedProfile: ProfileDetail = {
      ...profile,
      id: "opencode-profile",
      manifest: {
        ...profile.manifest,
        id: "opencode-profile",
        name: "OpenCode",
        createdFromTargetId: "opencode"
      },
      instructions: "Captured instructions"
    };
    const previewCapture = {
      id: "profile-capture",
      targetId: "opencode",
      targetName: "OpenCode",
      scope: "all" as const,
      suggestedName: "OpenCode",
      createdAt: "2026-07-24T00:00:00.000Z",
      resources: [],
      warnings: [],
      errors: []
    };
    const api = installApi({
      listTargetStates: vi.fn().mockResolvedValue([]),
      previewCreateProfileFromTarget: vi.fn().mockResolvedValue(previewCapture),
      createProfileFromTarget: vi.fn().mockResolvedValue({
        profile: capturedProfile,
        targetId: "opencode",
        importedSkillCount: 0,
        importedMcpCount: 0,
        warnings: []
      })
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    const targetCard = await screen.findByRole("article", { name: "Agent OpenCode" });
    fireEvent.click(
      within(targetCard).getByRole("button", { name: "Configure OpenCode" })
    );
    let dialog = screen.getByRole("dialog", { name: "Create profile from OpenCode" });
    expect(dialog).toHaveTextContent("Save the current environment as a reusable Profile");
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));

    await waitFor(() =>
      expect(api.previewCreateProfileFromTarget).toHaveBeenCalledWith(
        "opencode",
        "all"
      )
    );
    dialog = screen.getByRole("dialog", { name: "Review OpenCode capture" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Profile" }));

    await waitFor(() =>
      expect(api.createProfileFromTarget).toHaveBeenCalledWith({
        previewId: "profile-capture",
        name: "OpenCode"
      })
    );
    expect(await screen.findByRole("region", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Profile composer" })).toBeInTheDocument();
    expect(screen.getByText("OpenCode created. Agent unchanged.")).toBeInTheDocument();
  });

  it("reviews and confirms Stop Managing from Target diagnostics", async () => {
    const api = installApi({
      listTargetStates: vi.fn().mockResolvedValue([managedState()])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    fireEvent.click(await screen.findByRole("button", { name: "More actions for OpenCode" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Diagnostics" }));
    expect(screen.getByText("Detected via")).toBeInTheDocument();
    expect(screen.getByText("opencode command")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop managing OpenCode" }));

    const choiceDialog = screen.getByRole("dialog", { name: "Stop managing Agent" });
    expect(within(choiceDialog).getByText("Keep current environment")).toBeInTheDocument();
    const reviewButton = within(choiceDialog).getByRole("button", { name: "Review changes" });
    expect(reviewButton).toHaveClass("ui-button--primary");
    expect(reviewButton).not.toHaveClass("danger-action");
    fireEvent.click(reviewButton);

    expect(api.previewStopManaging).toHaveBeenCalledWith("opencode", "keep-current");
    const previewDialog = await screen.findByRole("dialog", { name: "Preview" });
    expect(within(previewDialog).getByText(/files will stay in place/)).toBeInTheDocument();
    const confirmButton = within(previewDialog).getByRole("button", { name: "Keep files and detach" });
    expect(confirmButton).toHaveClass("ui-button--danger");
    fireEvent.click(confirmButton);

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

    await openSettingsCategory("Data");
    const restoreTrigger = screen.getByRole("button", { name: "Restore data" });
    restoreTrigger.focus();
    fireEvent.click(restoreTrigger);
    const dialog = await screen.findByRole("dialog", { name: "Restore AgentEnv data" });
    expect(dialog).toHaveTextContent("6 top-level items");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus()
    );

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
    const previewManagedBackup = vi.fn().mockResolvedValue({
      id: requiredBackup.id,
      kind: requiredBackup.kind,
      files: [
        {
          path: "/Users/test/.config/opencode/AGENTS.md",
          state: "saved" as const
        },
        {
          path: "/Users/test/.config/opencode/skills/reviewer",
          state: "missing" as const
        }
      ]
    });
    const api = installApi({
      listManagedBackups,
      previewManagedBackup,
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

    await openSettingsCategory("Data");
    expect(await screen.findByText("2 backups · 6.0 KB")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Backup retention"), { target: { value: "90" } });
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({ backupRetentionDays: 90 }));

    fireEvent.click(screen.getByRole("button", { name: /^Manage$/ }));
    const manager = await screen.findByRole("dialog", { name: "Manage Backups" });
    expect(within(manager).getByText("Takeover baseline")).toBeInTheDocument();
    expect(within(manager).getByText("Required")).toBeInTheDocument();
    expect(within(manager).queryByRole("button", { name: /Delete backup Daily Coding/ })).not.toBeInTheDocument();

    fireEvent.click(within(manager).getByRole("button", {
      name: "Preview backup Daily Coding · opencode"
    }));
    expect(await within(manager).findByText("Backup contents")).toBeInTheDocument();
    expect(within(manager).getByText("/Users/test/.config/opencode/AGENTS.md")).toBeInTheDocument();
    expect(manager.querySelector('[data-file-icon="markdown"]')).toBeInTheDocument();
    expect(within(manager).getByText("Missing before change")).toBeInTheDocument();
    expect(previewManagedBackup).toHaveBeenCalledWith({
      id: requiredBackup.id,
      kind: requiredBackup.kind
    });
    fireEvent.click(within(manager).getByRole("button", { name: "Back" }));

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
    expect(editDialog.parentElement).toHaveAttribute(
      "data-dismiss-policy",
      "intentional"
    );
    fireEvent.change(within(editDialog).getByLabelText("Profile name"), {
      target: { value: "" }
    });
    fireEvent.click(editDialog.parentElement!);
    expect(screen.getByRole("dialog", { name: "Edit profile" })).toBeInTheDocument();
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
        expectedContentHash: "profile-hash",
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
    expect(within(createDialog).queryByLabelText("Preferred Agent")).not.toBeInTheDocument();
    expect(within(createDialog).queryByLabelText("Source Agent")).not.toBeInTheDocument();
    fireEvent.change(within(createDialog).getByLabelText("Profile name"), {
      target: { value: "Docs Writing" }
    });
    fireEvent.change(within(createDialog).getByLabelText("Description"), {
      target: { value: "Writing setup" }
    });
    fireEvent.click(within(createDialog).getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(api.createProfile).toHaveBeenCalledWith({
        preferredTargetId: "opencode",
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
        name: "OpenCode",
        description: "Captured from OpenCode"
      }
    };
    const api = installApi({
      previewCreateProfileFromTarget: vi.fn().mockResolvedValue({
        id: "capture-preview",
        targetId: "opencode",
        targetName: "OpenCode",
        suggestedName: "OpenCode",
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

    await waitFor(() =>
      expect(api.previewCreateProfileFromTarget).toHaveBeenCalledWith(
        "opencode",
        "all"
      )
    );
    dialog = screen.getByRole("dialog", { name: "Review OpenCode capture" });
    const impact = within(dialog).getByRole("region", { name: "Capture impact" });
    expect(within(impact).getByLabelText("Capture summary")).toHaveTextContent("0Source changes");
    expect(within(dialog).getByText("2 source copies stay unchanged")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    dialog = screen.getByRole("dialog", { name: "Create profile from OpenCode" });
    expect(within(dialog).getByLabelText("Profile name")).toHaveValue("OpenCode");
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));
    dialog = await screen.findByRole("dialog", { name: "Review OpenCode capture" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Profile" }));

    await waitFor(() =>
      expect(api.createProfileFromTarget).toHaveBeenCalledWith({
        previewId: "capture-preview",
        name: "OpenCode"
      })
    );
    expect(await screen.findByText("OpenCode created. Agent unchanged.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("keeps the Targets workspace and restores context when capture is cancelled", async () => {
    installApi();
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    const targetsWorkspace = await screen.findByRole("region", { name: "Agents" });
    const targetCard = within(targetsWorkspace).getByRole("article", { name: "Agent OpenCode" });
    fireEvent.click(within(targetCard).getByRole("button", { name: "Configure OpenCode" }));

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
          suggestedName: "OpenCode",
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
    await waitFor(() => expect(api.confirmWindowClose).toHaveBeenCalledOnce());
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
    const history = await openRecoveryHistory();
    const previewRollbackButton = within(history).getByRole("button", {
      name: "Preview restore Daily Coding"
    });
    fireEvent.click(previewRollbackButton);

    await waitFor(() => expect(api.previewRollback).toHaveBeenCalledWith(backup.id));
    const rollbackDialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(rollbackDialog).getByText("Rollback preview")).toBeInTheDocument();
    expect(within(rollbackDialog).getAllByText("AGENTS.md").length).toBeGreaterThan(0);
    expect(
      within(rollbackDialog).getByLabelText("Full location for AGENTS.md")
    ).toBeInTheDocument();

    expect(within(history).queryByRole("button", { name: "Restore backup" })).not.toBeInTheDocument();
    fireEvent.click(within(rollbackDialog).getByRole("button", { name: "Restore backup" }));

    await waitFor(() => expect(api.rollback).toHaveBeenCalledWith(backup.id));
    expect(screen.queryByText("Rollback preview")).not.toBeInTheDocument();
  });

  it("uses the confirmation preview when recovery starts from Targets", async () => {
    const api = installApi({
      listBackups: vi.fn().mockResolvedValue([backup])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    expect(screen.queryByRole("region", { name: "History" })).not.toBeInTheDocument();
    const recoveryTrigger = screen.getByRole("button", { name: "More Agent actions" });
    fireEvent.click(recoveryTrigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Recovery" }));
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
    const history = await openRecoveryHistory();
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
    const history = await openRecoveryHistory();
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
