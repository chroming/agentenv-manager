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
  SkillRuntimeIssue,
  SkillLibraryEntry,
  SkillUpdateInfo,
  TargetInfo,
  TargetManagementState
} from "../../src/shared/types";

const inventoryScan = (
  entries: SkillInventoryEntry[] = [],
  issues: SkillRuntimeIssue[] = []
) => ({ entries, issues });

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
  window.sessionStorage.clear();
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
  executableCandidates: ["opencode"],
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
    executableCandidates: ["opencode"],
    executableStatus: "found",
    executableCandidate: "opencode",
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
    readAppUpdateStatus: vi.fn().mockResolvedValue({
      phase: "idle",
      currentVersion: "0.1.0",
      installChannel: "development",
      automaticInstallSupported: false
    }),
    checkAppUpdate: vi.fn().mockResolvedValue({
      phase: "up-to-date",
      currentVersion: "0.1.0",
      installChannel: "development",
      automaticInstallSupported: false
    }),
    downloadAppUpdate: vi.fn().mockRejectedValue(new Error("Updates unavailable")),
    installAppUpdate: vi.fn().mockRejectedValue(new Error("Updates unavailable")),
    onAppUpdateStatusChanged: vi.fn().mockReturnValue(() => undefined),
    readTelemetryPreview: vi.fn().mockResolvedValue({
      enabledInBuild: false,
      destination: "PostHog Cloud",
      installationId: "31e27e20-a4ed-4a4a-96b1-c4213d2864eb",
      willCreateInstallationId: false,
      payload: {
        schemaVersion: 2,
        event: "agentenv_daily_startup",
        date: "2026-08-03",
        appVersion: "0.1.0",
        platform: "darwin",
        osMajor: "26",
        arch: "arm64",
        locale: "en",
        installChannel: "development"
      }
    }),
    decideTelemetry: vi.fn().mockResolvedValue({
      locale: "system",
      conversationTerminal: "default",
      skillSyncMethod: "auto",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      telemetryEnabled: true,
      telemetryConsentVersion: 1,
      backupRetentionDays: null
    }),
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
    selectProjectFolder: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn().mockResolvedValue([]),
    findProjectByPath: vi.fn().mockResolvedValue(undefined),
    addProject: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    updateProject: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    removeProject: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    inspectProject: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    previewProject: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    openProject: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    readProjectResource: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    prepareProjectInstruction: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    saveProjectResource: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    createProjectInstruction: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    addProjectSkill: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    removeProjectSkill: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    listProjectRecovery: vi.fn().mockResolvedValue([]),
    restoreProjectRecovery: vi.fn().mockRejectedValue(new Error("Project unavailable")),
    listProfileRecovery: vi.fn().mockResolvedValue([]),
    restoreProfileRecovery: vi.fn().mockRejectedValue(new Error("Profile unavailable")),
    restoreAppliedProfile: vi.fn().mockRejectedValue(new Error("Applied Profile unavailable")),
    probeSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
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
    listInstructionBlocks: vi.fn().mockResolvedValue([]),
    createInstructionBlock: vi.fn().mockRejectedValue(new Error("Instructions unavailable")),
    updateInstructionBlock: vi.fn().mockRejectedValue(new Error("Instructions unavailable")),
    removeInstructionBlock: vi.fn().mockRejectedValue(new Error("Instructions unavailable")),
    selectInstructionFile: vi.fn().mockResolvedValue(undefined),
    listSkillLibrary: vi.fn().mockResolvedValue([]),
    listSkillFiles: vi.fn().mockResolvedValue([]),
    readSkillFile: vi.fn().mockResolvedValue({
      path: "SKILL.md",
      kind: "text",
      sizeBytes: 0,
      content: ""
    }),
    scanSkillInventory: vi.fn().mockResolvedValue(inventoryScan()),
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
    readSharedSkillAreaState: vi.fn().mockResolvedValue({ formatVersion: 1, receipts: [] }),
    setSharedSkillAreaMode: vi.fn().mockImplementation(async (mode) => ({
      formatVersion: 1,
      mode,
      receipts: []
    })),
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
    setSkillTags: vi.fn().mockImplementation(async (input) => ({
      id: input.id,
      name: input.id,
      description: "",
      tags: input.tags,
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
    readLibrarySkillUpdateChange: vi.fn().mockRejectedValue(new Error("No deferred preview")),
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
      skillSyncMethod: "copy",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null,
      enabledTargetIds: ["opencode", "codex"],
      agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["opencode", "codex"]
    }),
    updateSettings: vi.fn().mockImplementation(async (input) => ({
      locale: input.locale ?? "system",
      conversationTerminal: input.conversationTerminal ?? "default",
      skillSyncMethod: input.skillSyncMethod ?? "copy",
      skillStorageLocation: input.skillStorageLocation ?? "appData",
      skillAutoCheckEnabled: input.skillAutoCheckEnabled ?? true,
      skillAutoCheckIntervalMinutes: input.skillAutoCheckIntervalMinutes ?? 60,
      backupRetentionDays: input.backupRetentionDays ?? null,
      enabledTargetIds: input.enabledTargetIds ?? ["opencode", "codex"],
      agentDiscoveryVersion: input.agentDiscoveryVersion ?? 1,
      agentDiscoveryReviewedIds: input.agentDiscoveryReviewedIds ?? ["opencode", "codex"]
    })),
    readUiState: vi.fn().mockResolvedValue({
      version: 1,
      profileOrder: [],
      agentOrder: [],
      workspaceOrder: [],
      workspaceAgentSelections: {}
    }),
    updateUiState: vi.fn().mockImplementation(async (input) => ({
      version: 1,
      profileOrder: input.profileOrder ?? [],
      agentOrder: input.agentOrder ?? [],
      workspaceOrder: input.workspaceOrder ?? [],
      workspaceAgentSelections: input.workspaceAgentSelections ?? {},
      selectedProfileId: input.selectedProfileId,
      selectedWorkspaceId: input.selectedWorkspaceId
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
      id: input.manifest.id,
      contentHash: "saved-profile-hash",
      targetContentHashes: {
        opencode: "saved-profile-hash",
        codex: "saved-codex-profile-hash",
        "claude-code": "saved-claude-profile-hash"
      }
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
        name: input.name ?? "New Profile",
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
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("App", () => {
  it("asks for telemetry consent before any optional Agent suggestion", async () => {
    const decideTelemetry = vi.fn();
    installApi({
      readTelemetryPreview: vi.fn().mockResolvedValue({
        enabledInBuild: true,
        destination: "PostHog Cloud",
        willCreateInstallationId: true,
        payload: {
          schemaVersion: 2,
          event: "agentenv_daily_startup",
          date: "2026-08-11",
          appVersion: "0.1.7",
          platform: "darwin",
          osMajor: "26",
          arch: "arm64",
          locale: "en",
          installChannel: "homebrew"
        }
      }),
      decideTelemetry
    });

    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "Anonymous usage statistics" });
    expect(dialog).toHaveTextContent("It never shares actions, results, paths");
    expect(screen.queryByRole("dialog", { name: "Choose Agents" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Decide later" }));
    expect(decideTelemetry).not.toHaveBeenCalled();
  });

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
    expect(screen.getByRole("heading", { name: "AgentEnv Manager" })).toBeInTheDocument();
    expect(
      within(workspace).getByRole("article", { name: "Agent OpenCode" })
    ).toBeInTheDocument();
    expect(within(workspace).getByRole("button", { name: "OpenCode" })).toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "Configure OpenCode" }))
      .not.toBeInTheDocument();
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
        within(workspace).getByRole("region", { name: "Profile status" })
      ).getByRole("button", { name: "Configure Agent" })
    ).toBeEnabled();
    expect(window.localStorage.getItem("agentenv:last-workspace")).toBeNull();
  });

  it("keeps a visible setup path when multiple enabled Agents have no Profiles", async () => {
    const settings: AgentEnvSettings = {
      locale: "system",
      conversationTerminal: "default",
      skillSyncMethod: "auto",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null,
      enabledTargetIds: ["opencode", "codex"],
      agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["opencode", "codex"],
      suppressedAgentSuggestionIds: []
    };
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      probeSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      listTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      listProfiles: vi.fn().mockResolvedValue([]),
      listTargetStates: vi.fn().mockResolvedValue([]),
      readSettings: vi.fn().mockResolvedValue(settings)
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    const status = await within(workspace).findByRole("region", { name: "Profile status" });
    const chooseAgent = within(status).getByRole("button", { name: "Choose Agent" });
    expect(chooseAgent).toBeEnabled();

    fireEvent.click(chooseAgent);
    const dialog = await screen.findByRole("dialog", { name: "Agents enabled" });
    expect(within(dialog).getByText("OpenCode")).toBeInTheDocument();
    expect(within(dialog).getByText("Codex")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button", { name: "Review current setup" }))
      .toHaveLength(2);
  });

  it("keeps an unclaimed shared folder outside first Agent setup", async () => {
    installApi({
      listProfiles: vi.fn().mockResolvedValue([]),
      listTargetStates: vi.fn().mockResolvedValue([]),
      scanSkillInventory: vi.fn().mockResolvedValue(inventoryScan([{
        id: "shared-onboarding",
        name: "Shared Onboarding",
        description: "Shared but not claimed",
        path: "/tmp/home/.agents/skills/shared-onboarding",
        foundIn: ["opencode"],
        status: "outside",
        skillKey: "shared-onboarding",
        contentHash: "shared-hash",
        sharedLocation: true,
        sharedLocationId: "agents-skills",
        locationManagement: "shared-runtime"
      } satisfies SkillInventoryEntry]))
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    expect(await within(workspace).findByText("Set up your first Agent"))
      .toBeInTheDocument();
    expect(within(workspace).getByText(
      "Save its current setup as a Profile. One shared Skill remains unchanged."
    )).toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "Review Skills" }))
      .not.toBeInTheDocument();
  });

  it("keeps Agent configuration available while the environment scan is pending", async () => {
    const inventoryRequest =
      deferred<Awaited<ReturnType<AgentEnvApi["scanSkillInventory"]>>>();
    installApi({
      scanSkillInventory: vi.fn().mockReturnValue(inventoryRequest.promise)
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    expect(within(workspace).queryByText("Checking local Skills")).not.toBeInTheDocument();
    expect(within(workspace).getByText("1 Agents detected · 1 Profiles"))
      .toBeInTheDocument();
    expect(
      within(workspace).getByRole("button", { name: "OpenCode" })
    ).toBeEnabled();

    await act(async () => {
      inventoryRequest.resolve(inventoryScan());
      await Promise.resolve();
    });
    expect(await within(workspace).findByText("1 Agents detected · 1 Profiles"))
      .toBeInTheDocument();
    expect(within(workspace).queryByRole("region", { name: "Profile status" }))
      .toBeNull();
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
      await within(workspace).findByText("Profile check unavailable")
    ).toBeInTheDocument();
    expect(
      within(workspace).getByRole("button", { name: "OpenCode" })
    ).toBeEnabled();
    expect(
      within(
        within(workspace).getByRole("region", { name: "Profile status" })
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
        locationManagement: "shared-runtime",
        sharedAreaMode: "managed"
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
      scanSkillInventory: vi.fn().mockResolvedValue(inventoryScan(inventory))
    });

    render(<App />);

    const workspace = await screen.findByRole("region", { name: "Agents" });
    expect(
      await within(workspace).findByText("1 shared Skill needs review")
    ).toBeInTheDocument();
    const environmentStatus = within(workspace).getByRole("region", {
      name: "Profile status"
    });
    expect(
      within(environmentStatus).getByText(
        "Shared locations are used by OpenCode."
      )
    ).toHaveAttribute("data-ui-overflow-detail", "true");
    fireEvent.click(
      within(environmentStatus).getByRole("button", { name: "Review Skills" })
    );

    const drawer = await screen.findByRole("region", { name: "Shared Skills" });
    expect(within(drawer).getByText("Shared Skills")).toBeInTheDocument();
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
      name: "Profile status"
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
    expect(within(workspace).queryByRole("region", { name: "Profile status" }))
      .toBeNull();
    expect(within(workspace).getByText("1 Agents detected · 1 Profiles"))
      .toBeInTheDocument();
    expect(
      within(within(workspace).getByRole("article", { name: "Agent OpenCode" }))
        .getByText("Local overrides")
    ).toBeInTheDocument();
  });

  it("orders the primary navigation by the environment workflow", async () => {
    installApi();
    render(<App />);

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    const agents = within(navigation).getByRole("button", { name: "Agents" });
    const projects = within(navigation).getByRole("button", { name: "Workspaces" });
    const profiles = within(navigation).getByRole("button", { name: "Profiles" });
    const conversations = within(navigation).getByRole("button", {
      name: "Conversations"
    });
    const skills = within(navigation).getByRole("button", { name: "Skills" });

    expect(agents.compareDocumentPosition(profiles) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(profiles.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(projects.compareDocumentPosition(conversations) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
    expect(conversations.compareDocumentPosition(skills) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });

  it("adds and removes a Project reference without presenting a folder delete action", async () => {
    const addedProject = {
      id: "project-example",
      name: "example",
      rootPath: "/work/example",
      createdAt: "2026-08-06T00:00:00.000Z",
      lastOpenedAt: "2026-08-06T00:00:00.000Z",
      exists: true
    };
    const listProjects = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([addedProject])
      .mockResolvedValueOnce([{ ...addedProject, lastAgentId: "opencode" }])
      .mockResolvedValueOnce([]);
    const addProject = vi.fn().mockResolvedValue(addedProject);
    const removeProject = vi.fn().mockResolvedValue(undefined);
    const inspectProject = vi.fn().mockResolvedValue({
      projectId: addedProject.id,
      projectRoot: addedProject.rootPath,
      resources: [{
        id: "instructions-1",
        kind: "instructions",
        name: "AGENTS.md",
        relativePath: "AGENTS.md",
        absolutePath: "/work/example/AGENTS.md",
        consumerAgentIds: ["opencode"],
        state: "ready",
        editable: true
      }],
      agentSupport: [{
        agentId: "opencode",
        agentName: "OpenCode",
        instructions: { inspect: "supported", mutate: "supported" },
        instructionCreateFile: "AGENTS.md",
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "partial", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      }],
      issues: [],
      partial: true
    });
    const previewProject = vi.fn().mockResolvedValue({
      projectId: addedProject.id,
      agentId: "opencode",
      agentName: "OpenCode",
      fidelity: "partial",
      loadOrder: "unknown",
      projectResources: [],
      globalResources: [],
      issues: []
    });
    const openProject = vi.fn().mockResolvedValue({
      agentId: "opencode",
      agentName: "OpenCode",
      message: "Opened example in OpenCode"
    });
    installApi({
      selectProjectFolder: vi.fn().mockResolvedValue("/work/example"),
      listProjects,
      addProject,
      removeProject,
      inspectProject,
      previewProject,
      openProject
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Workspaces" }));
    expect(await screen.findByRole("heading", { name: "Workspaces" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add folder" }));

    expect((await screen.findAllByText("/work/example")).length).toBeGreaterThan(0);
    expect(addProject).toHaveBeenCalledWith("/work/example");
    expect(screen.queryByRole("button", { name: /Delete folder/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More Workspace actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Loaded resource details" }));
    expect(await screen.findByRole("dialog", { name: "Loaded resource details" }))
      .toBeInTheDocument();
    expect(previewProject).toHaveBeenCalledWith("project-example", "opencode");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Open in OpenCode" }));
    await waitFor(() => expect(openProject).toHaveBeenCalledWith("project-example", "opencode"));

    fireEvent.click(screen.getByRole("button", { name: "More Workspace actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove reference" }));
    expect(await screen.findByText("Remove Workspace reference?")).toBeInTheDocument();
    expect(screen.getByText("The folder and its files will stay unchanged.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove reference" }));

    await waitFor(() => expect(removeProject).toHaveBeenCalledWith("project-example"));
  });

  it("keeps macOS window chrome quiet and page actions in their content", async () => {
    installApi();
    render(<App />);

    const titlebar = document.querySelector<HTMLElement>(".shell-titlebar")!;
    const editor = screen.getByRole("main").querySelector<HTMLElement>(".editor-panel")!;
    const navigation = await screen.findByRole("navigation", { name: "Primary navigation" });
    expect(within(titlebar).queryByRole("heading")).not.toBeInTheDocument();
    expect(within(titlebar).queryByRole("button", { name: "Refresh" }))
      .not.toBeInTheDocument();
    expect(within(editor).getByRole("heading", { name: "Agents" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Refresh" })).toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Profiles" }));
    expect(await within(editor).findByRole("heading", { name: "Profiles" }))
      .toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Choose Profile" }))
      .toBeInTheDocument();
    expect(within(titlebar).queryByRole("button", { name: "Choose Profile" }))
      .not.toBeInTheDocument();

    fireEvent.click(within(navigation).getByRole("button", { name: "Skills" }));
    expect(await within(editor).findByRole("heading", { name: "Skills" }))
      .toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Import skills" }))
      .toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Local Skills" }))
      .toBeInTheDocument();
    expect(within(editor).queryByRole("button", { name: "More Skill actions" }))
      .not.toBeInTheDocument();
    const refreshSkills = within(editor).getByRole("button", { name: "Refresh skills" });
    expect(refreshSkills).toHaveClass("ui-button", "ui-button--secondary");
    expect(refreshSkills).toHaveTextContent("Refresh");
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

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
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

  const openProfileSwitcher = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Choose Profile" }));
    return screen.findByRole("dialog", { name: "Choose Profile" });
  };

  const expandProfileInstructions = () => {
    const composer = screen.getByRole("region", { name: "Profile composer" });
    const trigger = within(composer).getByRole("button", { name: "Instructions" });
    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  };

  const profileInstructionPreview = () => {
    expandProfileInstructions();
    const composer = screen.getByRole("region", { name: "Profile composer" });
    fireEvent.click(within(composer).getByRole("button", { name: "Open AGENTS.md" }));
    const dialog = screen.getByRole("dialog", { name: "Instruction document" });
    const preview = within(dialog).getByLabelText("Preview of AGENTS.md");
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);
    return preview;
  };

  const editProfileInstructions = async (value: string) => {
    expandProfileInstructions();
    fireEvent.click(screen.getByRole("button", { name: "Open AGENTS.md" }));
    const dialog = screen.getByRole("dialog", { name: "Instruction document" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Profile instruction content" }), {
      target: { value }
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Edit" }))
      .toBeInTheDocument());
    expect(within(dialog).getByLabelText("Preview of AGENTS.md"))
      .toHaveTextContent(value.trim());
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]!);
  };

  const clickNewProfile = async () => {
    const switcher = await openProfileSwitcher();
    fireEvent.click(within(switcher).getByRole("button", { name: "New Profile" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Recovery" }));
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
      "Ready to apply"
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
    expect(emptyMcpRow.querySelector('.ui-resource-disclosure__summary'))
      .toHaveAttribute("title", "Saved 0 · Agent 0");
    expect(within(composer).queryByRole("button", { name: "Advanced" })).not.toBeInTheDocument();
    for (const oldTab of ["Overview", "Instructions", "Config", "Resources", "Validation"]) {
      expect(screen.queryByRole("tab", { name: oldTab })).not.toBeInTheDocument();
    }

    fireEvent.click(within(composer).getByRole("button", { name: "Instructions" }));
    expect(profileInstructionPreview()).toHaveTextContent("# Agent");
    fireEvent.click(within(composer).getByRole("button", { name: "MCPs" }));
    expect(
      within(composer).getByRole("combobox", {
        name: "MCPs application policy for OpenCode"
      })
    ).toHaveValue("ignore");
    expect(screen.getByTitle("Saved 0 · Agent 0")).toBeInTheDocument();
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

  it("suggests detected disabled Agents without changing their files or settings automatically", async () => {
    let enabledTargetIds: string[] = [];
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      enabledTargetIds = input.enabledTargetIds ?? enabledTargetIds;
      return {
        locale: "system" as const,
        conversationTerminal: "default" as const,
        skillSyncMethod: "auto" as const,
        skillStorageLocation: "appData" as const,
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds,
        agentDiscoveryVersion: input.agentDiscoveryVersion,
        agentDiscoveryReviewedIds: input.agentDiscoveryReviewedIds,
        suppressedAgentSuggestionIds: input.suppressedAgentSuggestionIds ?? []
      };
    });
    const missingCodex = {
      ...codexTarget,
      health: {
        ...codexTarget.health,
        status: "missing" as const,
        installationFound: false,
        installationEvidence: [],
        executableStatus: "missing" as const,
        executableCandidate: undefined,
        executablePath: undefined,
        executableFound: false,
        canWrite: false,
        summary: "Not detected"
      }
    };
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      probeSupportedTargets: vi.fn().mockResolvedValue([target, missingCodex]),
      listTargets: vi.fn(async () => enabledTargetIds.length > 0 ? [target] : []),
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        conversationTerminal: "default",
        skillSyncMethod: "auto",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds,
        suppressedAgentSuggestionIds: []
      }),
      updateSettings
    });
    const view = render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "Choose Agents" });
    expect(dialog).toHaveTextContent("does not Capture, Apply, or change Agent files");
    expect(within(dialog).getByRole("checkbox", { name: "OpenCode" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Codex" })).not.toBeChecked();
    expect(dialog).toHaveTextContent("Not detected");
    expect(updateSettings).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose Agents" })).not.toBeInTheDocument());
    expect(updateSettings).not.toHaveBeenCalled();

    view.unmount();
    render(<App />);
    await screen.findByRole("region", { name: "Agents" });
    expect(screen.queryByRole("dialog", { name: "Choose Agents" })).not.toBeInTheDocument();

    const agentsWorkspace = await screen.findByRole("region", { name: "Agents" });
    fireEvent.click(within(agentsWorkspace).getByRole("button", { name: "Choose Agents" }));
    const reopened = screen.getByRole("dialog", { name: "Choose Agents" });
    fireEvent.click(within(reopened).getByRole("button", { name: "Enable 1 Agent" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      enabledTargetIds: ["opencode"],
      agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["opencode"],
      suppressedAgentSuggestionIds: []
    }));
    expect(await within(agentsWorkspace).findByRole("article", { name: "Agent OpenCode" }))
      .toBeInTheDocument();
  });

  it("does not suggest the same Agents after a confirmed choice survives a new renderer session", async () => {
    let settings: AgentEnvSettings = {
      locale: "system",
      conversationTerminal: "default",
      skillSyncMethod: "auto",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null,
      enabledTargetIds: [],
      agentDiscoveryReviewedIds: [],
      suppressedAgentSuggestionIds: []
    };
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      settings = { ...settings, ...input };
      return settings;
    });
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target]),
      probeSupportedTargets: vi.fn().mockResolvedValue([target]),
      listTargets: vi.fn(async () => settings.enabledTargetIds?.includes(target.id) ? [target] : []),
      readSettings: vi.fn(async () => settings),
      updateSettings
    });

    const firstSession = render(<App />);
    const chooser = await screen.findByRole("dialog", { name: "Choose Agents" });
    fireEvent.click(within(chooser).getByRole("button", { name: "Enable 1 Agent" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up later" }));
    await waitFor(() => expect(settings).toMatchObject({
      enabledTargetIds: ["opencode"],
      agentDiscoveryVersion: 1,
      agentDiscoveryReviewedIds: ["opencode"]
    }));

    firstSession.unmount();
    window.sessionStorage.clear();
    render(<App />);
    await screen.findByRole("region", { name: "Agents" });

    expect(screen.queryByRole("dialog", { name: "Choose Agents" })).not.toBeInTheDocument();
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it("offers the canonical Agent setup flow after enabling without changing Agent files", async () => {
    let enabledTargetIds: string[] = [];
    const previewCreateProfileFromTarget = vi.fn().mockRejectedValue(
      new Error("Review should start only after the user requests it")
    );
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target]),
      probeSupportedTargets: vi.fn().mockResolvedValue([target]),
      listTargets: vi.fn(async () => enabledTargetIds.length > 0 ? [target] : []),
      listProfiles: vi.fn().mockResolvedValue([]),
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        conversationTerminal: "default",
        skillSyncMethod: "auto",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds,
        suppressedAgentSuggestionIds: []
      }),
      updateSettings: vi.fn(async (input: Partial<AgentEnvSettings>) => {
        enabledTargetIds = input.enabledTargetIds ?? enabledTargetIds;
        return {
          locale: "system" as const,
          conversationTerminal: "default" as const,
          skillSyncMethod: "auto" as const,
          skillStorageLocation: "appData" as const,
          skillAutoCheckEnabled: true,
          skillAutoCheckIntervalMinutes: 60,
          backupRetentionDays: null,
          enabledTargetIds,
          agentDiscoveryVersion: input.agentDiscoveryVersion,
          agentDiscoveryReviewedIds: input.agentDiscoveryReviewedIds,
          suppressedAgentSuggestionIds: []
        };
      }),
      previewCreateProfileFromTarget
    });
    render(<App />);

    const chooser = await screen.findByRole("dialog", { name: "Choose Agents" });
    fireEvent.click(within(chooser).getByRole("button", { name: "Enable 1 Agent" }));

    const nextStep = await screen.findByRole("dialog", { name: "Agents enabled" });
    expect(nextStep).toHaveTextContent("Agent files have not changed");
    expect(nextStep).toHaveTextContent("OpenCode");
    expect(previewCreateProfileFromTarget).not.toHaveBeenCalled();

    fireEvent.click(within(nextStep).getByRole("button", { name: "Review current setup" }));
    expect(await screen.findByRole("dialog", { name: "Create Profile from OpenCode" }))
      .toBeInTheDocument();
    expect(previewCreateProfileFromTarget).not.toHaveBeenCalled();
  });

  it("asks existing installations to review Agents once for the current discovery version", async () => {
    const missingCodex = {
      ...codexTarget,
      health: {
        ...codexTarget.health,
        status: "missing" as const,
        installationFound: false,
        installationEvidence: [],
        executableStatus: "missing" as const,
        executableCandidate: undefined,
        executablePath: undefined,
        executableFound: false,
        canWrite: false,
        summary: "Not detected"
      }
    };
    let settings: AgentEnvSettings = {
      locale: "system",
      conversationTerminal: "default",
      skillSyncMethod: "auto",
      skillStorageLocation: "appData",
      skillAutoCheckEnabled: true,
      skillAutoCheckIntervalMinutes: 60,
      backupRetentionDays: null,
      enabledTargetIds: ["opencode", "codex"],
      agentDiscoveryReviewedIds: ["opencode", "codex"],
      suppressedAgentSuggestionIds: []
    };
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      settings = { ...settings, ...input };
      return settings;
    });
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      probeSupportedTargets: vi.fn().mockResolvedValue([target, missingCodex]),
      listTargets: vi.fn(async () => [target, codexTarget]
        .filter((item) => settings.enabledTargetIds?.includes(item.id))),
      readSettings: vi.fn(async () => settings),
      updateSettings
    });

    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "Choose Agents" });
    expect(within(dialog).getByRole("checkbox", { name: "OpenCode" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Codex" })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Enable 1 Agent" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      enabledTargetIds: ["opencode"],
      agentDiscoveryVersion: 1,
      suppressedAgentSuggestionIds: [],
      agentDiscoveryReviewedIds: ["opencode"]
    }));
  });

  it("keeps multiple newly enabled Agents independent and lets setup wait", async () => {
    let enabledTargetIds: string[] = [];
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      enabledTargetIds = input.enabledTargetIds ?? enabledTargetIds;
      return {
        locale: "system" as const,
        conversationTerminal: "default" as const,
        skillSyncMethod: "auto" as const,
        skillStorageLocation: "appData" as const,
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds,
        agentDiscoveryVersion: input.agentDiscoveryVersion,
        agentDiscoveryReviewedIds: input.agentDiscoveryReviewedIds,
        suppressedAgentSuggestionIds: []
      };
    });
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      probeSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      listTargets: vi.fn(async () =>
        [target, codexTarget].filter((item) => enabledTargetIds.includes(item.id))),
      listProfiles: vi.fn().mockResolvedValue([
        {
          id: "captured-opencode",
          preferredTargetId: "opencode",
          createdFromTargetId: "opencode",
          name: "OpenCode setup",
          description: "",
          createdAt: "2026-08-01T10:00:00.000Z"
        },
        {
          id: "active-codex",
          preferredTargetId: "codex",
          name: "Codex Review",
          description: ""
        }
      ]),
      readProfile: vi.fn(async (id) => ({
        ...profile,
        id,
        manifest: {
          ...profile.manifest,
          id,
          preferredTargetId: id === "active-codex" ? "codex" : "opencode",
          name: id === "active-codex" ? "Codex Review" : "OpenCode setup"
        }
      })),
      listTargetStates: vi.fn(async () => enabledTargetIds.includes("codex")
        ? [managedState({
            targetId: "codex",
            activeProfileId: "active-codex",
            activeProfileName: "Codex Review"
          })]
        : []),
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        conversationTerminal: "default",
        skillSyncMethod: "auto",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds,
        suppressedAgentSuggestionIds: []
      }),
      updateSettings
    });
    render(<App />);

    const chooser = await screen.findByRole("dialog", { name: "Choose Agents" });
    fireEvent.click(within(chooser).getByRole("button", { name: "Enable 2 Agents" }));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Action failed")).not.toBeInTheDocument();
    const nextStep = await screen.findByRole("dialog", { name: "Agents enabled" });
    expect(within(nextStep).getByRole("button", { name: "Continue setup" }))
      .toBeInTheDocument();
    expect(within(nextStep).getByRole("button", { name: "Open Profile" }))
      .toBeInTheDocument();

    fireEvent.click(within(nextStep).getByRole("button", { name: "Set up later" }));
    await waitFor(() => expect(
      screen.queryByRole("dialog", { name: "Agents enabled" })
    ).not.toBeInTheDocument());
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit suggestion suppression in advanced Settings and makes restoration visible", async () => {
    let suppressedAgentSuggestionIds: string[] = [];
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      suppressedAgentSuggestionIds =
        input.suppressedAgentSuggestionIds ?? suppressedAgentSuggestionIds;
      return {
        locale: "system" as const,
        conversationTerminal: "default" as const,
        skillSyncMethod: "auto" as const,
        skillStorageLocation: "appData" as const,
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds: [],
        agentDiscoveryVersion: 1,
        agentDiscoveryReviewedIds: input.agentDiscoveryReviewedIds,
        suppressedAgentSuggestionIds
      };
    });
    installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target]),
      probeSupportedTargets: vi.fn().mockResolvedValue([target]),
      listTargets: vi.fn().mockResolvedValue([]),
      readSettings: vi.fn().mockResolvedValue({
        locale: "system",
        conversationTerminal: "default",
        skillSyncMethod: "auto",
        skillStorageLocation: "appData",
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds: [],
        agentDiscoveryVersion: 1,
        suppressedAgentSuggestionIds
      }),
      updateSettings
    });
    render(<App />);

    const dialog = await screen.findByRole("dialog", { name: "Choose Agents" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't suggest OpenCode again" }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      agentDiscoveryReviewedIds: ["opencode"],
      suppressedAgentSuggestionIds: ["opencode"]
    }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose Agents" })).not.toBeInTheDocument());

    await openSettingsCategory("Agents");
    expect(screen.queryByRole("button", { name: "Suggest OpenCode again" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Future Agent suggestions"));
    expect(screen.getByText("Won't suggest: OpenCode")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow future suggestions" }));
    await waitFor(() => expect(updateSettings).toHaveBeenLastCalledWith({
      agentDiscoveryReviewedIds: [],
      suppressedAgentSuggestionIds: []
    }));
    expect(await screen.findByText("No Agent suggestions are ignored"))
      .toBeInTheDocument();
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
      inventoryRequest.resolve(inventoryScan());
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
    expect(await screen.findByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
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
        .getByRole("button", { name: "Review update github-reviewer" })
    ).toHaveTextContent("Update available");
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
    await waitFor(() => expect(listSkillLibrary).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Skills refreshed")).not.toBeInTheDocument();
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

  it("reconciles a stale update row when preview finds the Skill was removed upstream", async () => {
    const skill = {
      id: "removed-reviewer",
      name: "Removed Reviewer",
      description: "Review from a removed source",
      path: "/tmp/skills-library/removed-reviewer",
      sourceType: "github" as const,
      source: "https://github.com/acme/skills/tree/main/removed-reviewer",
      updatePolicy: "tracked" as const,
      remoteRevision: "revision-1",
      contentHash: "hash-1",
      updatedAt: "2026-07-02T00:00:00.000Z"
    };
    installApi({
      listSkillLibrary: vi.fn().mockResolvedValue([skill]),
      checkSkillLibraryUpdates: vi.fn().mockResolvedValue([{
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        currentRevision: "revision-1",
        latestRevision: "revision-2",
        updateAvailable: true
      }]),
      previewLibrarySkillUpdate: vi.fn().mockResolvedValue({
        id: skill.id,
        name: skill.name,
        sourceType: skill.sourceType,
        source: skill.source,
        currentRevision: "revision-1",
        updateAvailable: false,
        sourceStatus: "removed",
        changes: [],
        errors: [],
        impact: {
          profileNames: [],
          linkedInstallCount: 0,
          linkedTargetIds: [],
          copiedInstallCount: 0,
          copiedTargetIds: []
        }
      })
    });
    render(<App />);

    await openLibrary();
    const row = await screen.findByRole("group", { name: "Library item removed-reviewer" });
    fireEvent.click(screen.getByRole("button", { name: "Check updates" }));
    const updateStatus = await within(row).findByRole("button", {
      name: "Review update removed-reviewer"
    });
    fireEvent.click(updateStatus);

    await waitFor(() => expect(row).toHaveTextContent("Removed upstream"));
    expect(screen.getByRole("status")).toHaveTextContent(
      "removed-reviewer was removed upstream"
    );
    expect(screen.queryByRole("dialog", { name: /Update preview/ })).toBeNull();
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
      within(row).getByRole("button", { name: "Review update source-reviewer" })
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
      within(row).queryByRole("button", { name: "Review update source-reviewer" })
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
    fireEvent.click(within(localRow).getByRole("button", { name: "More actions for local-reviewer" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit tags" }));
    const tagInput = screen.getByRole("textbox", { name: "Add a tag" });
    fireEvent.change(tagInput, { target: { value: "Code Review" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.setSkillTags).toHaveBeenCalledWith({
        id: "local-reviewer",
        tags: ["Code Review"]
      })
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
      scanSkillInventory: vi.fn().mockResolvedValueOnce(inventoryScan([
        {
          id: "target-only-reviewer",
          name: "Target Only Reviewer",
          description: "Found on disk",
          path: "/tmp/opencode/skills/target-only-reviewer",
          foundIn: ["opencode"],
          status: "outside",
          skillKey: "target-only-reviewer",
          contentHash: "target-only-hash"
        }
      ])).mockResolvedValueOnce(inventoryScan([
        {
          id: "refreshed-reviewer",
          name: "Refreshed Reviewer",
          description: "Found after rescanning",
          path: "/tmp/opencode/skills/refreshed-reviewer",
          foundIn: ["opencode"],
          status: "outside",
          skillKey: "refreshed-reviewer",
          contentHash: "refreshed-hash"
        }
      ])).mockResolvedValueOnce(inventoryScan([
        {
          id: "toolbar-reviewer",
          name: "Toolbar Reviewer",
          description: "Found from the toolbar refresh",
          path: "/tmp/opencode/skills/toolbar-reviewer",
          foundIn: ["opencode"],
          status: "outside",
          skillKey: "toolbar-reviewer",
          contentHash: "toolbar-hash"
        }
      ]))
    });
    render(<App />);

    await openLibrary();
    await screen.findByRole("region", { name: "Skill library" });
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Local Skills" }));

    expect(await screen.findByRole("region", { name: "Local Skills Manager" })).toBeInTheDocument();
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("group", { name: "Cleanup group refreshed-reviewer" })
    ).toHaveTextContent("Found after rescanning");

    fireEvent.click(screen.getByRole("button", { name: "Refresh local skills" }));
    expect(
      await screen.findByRole("group", { name: "Cleanup group toolbar-reviewer" })
    ).toHaveTextContent("Found from the toolbar refresh");
    expect(api.scanSkillInventory).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("Local skills refreshed")).not.toBeInTheDocument();
  });

  it("shows partial Local Skills scan failures without hiding readable results", async () => {
    installApi({
      scanSkillInventory: vi.fn().mockResolvedValue(inventoryScan(
        [{
          id: "readable-reviewer",
          name: "Readable Reviewer",
          description: "Still available",
          path: "/tmp/opencode/skills/readable-reviewer",
          foundIn: ["opencode"],
          status: "outside",
          skillKey: "readable-reviewer",
          contentHash: "readable-hash"
        }],
        [{
          code: "unreadable-skill-location",
          severity: "warning",
          message: "Skill location could not be scanned: /tmp/codex/skills"
        }]
      ))
    });
    render(<App />);

    await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Local Skills" }));

    expect(await screen.findByText("Some Skill locations could not be scanned"))
      .toBeInTheDocument();
    expect(screen.getByText("Skill location could not be scanned: /tmp/codex/skills"))
      .toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Cleanup group readable-reviewer" }))
      .toBeInTheDocument();
  });

  it("automatically rescans Local Skills on entry after the freshness window", async () => {
    let now = Date.parse("2026-07-29T10:00:00.000Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const api = installApi({
      scanSkillInventory: vi.fn()
        .mockResolvedValueOnce(inventoryScan())
        .mockResolvedValueOnce(inventoryScan([{
          id: "new-local-skill",
          name: "New Local Skill",
          description: "Appeared after startup",
          path: "/tmp/opencode/skills/new-local-skill",
          foundIn: ["opencode"],
          status: "outside",
          skillKey: "new-local-skill",
          contentHash: "new-local-hash"
        }]))
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

  it("refreshes the Profile switcher after Workspace Sync updates this device", async () => {
    let workspaceUpdated = false;
    const syncedProfile: ProfileDetail = {
      ...profile,
      id: "synced-review",
      profileDir: "/tmp/profiles/synced-review",
      manifest: {
        ...profile.manifest,
        id: "synced-review",
        name: "Synced Review"
      },
      contentHash: "synced-profile-hash"
    };
    const syncStatus = {
      kind: "remote-changes" as const,
      connection: { repository: "git@github.com:me/workspace.git", branch: "main" },
      localChangeCount: 0,
      remoteChangeCount: 1,
      conflictCount: 0,
      immediateAgentCount: 0
    };
    const api = installApi({
      listProfiles: vi.fn(async () => [
        {
          id: profile.id,
          preferredTargetId: profile.manifest.preferredTargetId,
          name: profile.manifest.name,
          description: profile.manifest.description,
          contentHash: profile.contentHash
        },
        ...(workspaceUpdated
          ? [{
              id: syncedProfile.id,
              preferredTargetId: syncedProfile.manifest.preferredTargetId,
              name: syncedProfile.manifest.name,
              description: syncedProfile.manifest.description,
              contentHash: syncedProfile.contentHash
            }]
          : [])
      ]),
      readProfile: vi.fn(async (profileId) =>
        profileId === syncedProfile.id ? syncedProfile : profile),
      readWorkspaceSyncStatus: vi.fn().mockResolvedValue(syncStatus),
      checkWorkspaceSync: vi.fn().mockResolvedValue(syncStatus),
      reviewWorkspaceSync: vi.fn().mockResolvedValue({
        baseRevision: "base",
        remoteRevision: "remote",
        changes: [{
          key: "profile:synced-review:manifest",
          resourceKind: "profile",
          resourceId: syncedProfile.id,
          section: "manifest",
          action: "add",
          direction: "remote",
          title: syncedProfile.manifest.name
        }],
        liveSkillIds: [],
        liveAgentIds: [],
        canUpdate: true,
        canPublish: false
      }),
      updateWorkspaceFromSync: vi.fn().mockImplementation(async () => {
        workspaceUpdated = true;
        return {
          status: {
            ...syncStatus,
            kind: "up-to-date" as const,
            remoteChangeCount: 0
          }
        };
      })
    });
    render(<App />);

    await openSettingsCategory("Connections");
    fireEvent.click(await screen.findByRole("button", { name: "Update this device" }));
    const review = await screen.findByRole("dialog", { name: "Review Device Sync changes" });
    fireEvent.click(within(review).getByRole("button", { name: "Update this device" }));
    await waitFor(() => expect(api.updateWorkspaceFromSync).toHaveBeenCalledTimes(1));

    await openProfiles();
    const switcher = await openProfileSwitcher();
    expect(within(switcher).getByText("Synced Review")).toBeInTheDocument();
  });

  it("presents Copy on Apply as the default recommended Skill deployment mode", async () => {
    installApi();
    render(<App />);

    await openSettingsCategory("Skills");

    const syncMethod = screen.getByLabelText("Global skill deployment method");
    expect(syncMethod).toHaveValue("copy");
    expect(
      within(syncMethod).getByRole("option", { name: "Copy on Apply (recommended)" })
    ).toBeInTheDocument();
    expect(within(syncMethod).queryByRole("option", { name: /Auto/ })).toBeNull();
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
    expect(generalTab.closest("[role=tablist]")).toHaveClass("ui-tab-bar");
    expect(generalTab.closest("[role=tablist]")).not.toHaveClass("ui-segmented-control");
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
    expect(await screen.findByText("Logs & diagnostics")).toBeInTheDocument();
    const logsButton = screen.getByRole("button", { name: "Open logs" });
    expect(logsButton).toHaveClass("ui-button", "ui-button--secondary");
    const copyAction = await screen.findByRole("button", { name: "Copy latest issue" });
    expect(screen.queryByRole("button", { name: "More diagnostics actions" }))
      .not.toBeInTheDocument();
    fireEvent.click(copyAction);
    await waitFor(() =>
      expect(api.copyText).toHaveBeenCalledWith(expect.stringContaining("Inventory failed"))
    );
    const exportButton = screen.getByRole("button", { name: "Export report" });
    expect(exportButton).toHaveClass("ui-button", "ui-button--secondary");
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
    fireEvent.click(logsButton);
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
    let agentDiscoveryReviewedIds: string[] = [];
    let suppressedAgentSuggestionIds: string[] = [];
    const allTargets = [target, codexTarget];
    const listTargets = vi.fn(async () =>
      allTargets.filter((item) => enabledTargetIds.includes(item.id))
    );
    const updateSettings = vi.fn(async (input: Partial<AgentEnvSettings>) => {
      enabledTargetIds = input.enabledTargetIds ?? enabledTargetIds;
      agentDiscoveryReviewedIds =
        input.agentDiscoveryReviewedIds ?? agentDiscoveryReviewedIds;
      suppressedAgentSuggestionIds =
        input.suppressedAgentSuggestionIds ?? suppressedAgentSuggestionIds;
      return {
        locale: "system" as const,
        conversationTerminal: "default" as const,
        skillSyncMethod: "symlink" as const,
        skillStorageLocation: "appData" as const,
        skillAutoCheckEnabled: true,
        skillAutoCheckIntervalMinutes: 60,
        backupRetentionDays: null,
        enabledTargetIds,
        agentDiscoveryVersion: 1,
        agentDiscoveryReviewedIds,
        suppressedAgentSuggestionIds
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
        enabledTargetIds,
        agentDiscoveryVersion: 1,
        agentDiscoveryReviewedIds
      }),
      updateSettings
    });
    render(<App />);

    await openSettingsCategory("Agents");
    fireEvent.click(screen.getByRole("switch", { name: "Turn off Codex" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        enabledTargetIds: ["opencode"],
        agentDiscoveryReviewedIds: ["codex"],
        suppressedAgentSuggestionIds: []
      })
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
      expect(updateSettings).toHaveBeenLastCalledWith({
        enabledTargetIds: [],
        agentDiscoveryReviewedIds: ["codex", "opencode"],
        suppressedAgentSuggestionIds: []
      })
    );
    const agentsNavigation = screen.getByRole("button", { name: "Agents" });
    expect(agentsNavigation).toBeInTheDocument();
    fireEvent.click(agentsNavigation);
    expect(
      await screen.findByRole("region", { name: "Agents" })
    ).toHaveTextContent("No enabled Agents");

    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
    await screen.findByRole("region", { name: "Profiles" });
    expect(screen.getByRole("button", { name: "Select apply Agent" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();
    expect(api.listSupportedTargets).toHaveBeenCalled();
  });

  it("persists Agent order from Settings and applies it to the Agents workspace", async () => {
    const api = installApi({
      listSupportedTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      listTargets: vi.fn().mockResolvedValue([target, codexTarget])
    });
    render(<App />);

    await openSettingsCategory("Agents");
    fireEvent.keyDown(screen.getByRole("button", { name: "Reorder OpenCode" }), {
      altKey: true,
      key: "ArrowDown"
    });

    await waitFor(() => expect(api.updateUiState).toHaveBeenCalledWith({
      agentOrder: ["codex", "opencode"]
    }));
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(await screen.findByRole("region", { name: "Agents" })).toBeInTheDocument();
    expect([...document.querySelectorAll(".target-workflow-name-action")]
      .map((item) => item.textContent)).toEqual(["Codex", "OpenCode"]);
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
        agentDiscoveryVersion: 1,
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
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      enabledTargetIds: [],
      agentDiscoveryReviewedIds: ["opencode"],
      suppressedAgentSuggestionIds: []
    }));
    const agentStatus = document.querySelector(".agent-settings-status") as HTMLElement;
    expect(within(agentStatus).getByText("Saving...")).toBeInTheDocument();
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
    await waitFor(() => expect(within(agentStatus).queryByText("Saving...")).not.toBeInTheDocument());
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
      within(screen.getByRole("navigation", { name: "Primary navigation" })).queryByRole(
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
    fireEvent.change(
      await screen.findByRole("combobox", {
        name: "MCPs application policy for OpenCode"
      }),
      { target: { value: "manage" } }
    );
    const toggle = await screen.findByRole("switch", { name: "Turn off context7" });
    expect(toggle).toBeChecked();
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
    expect(
      vi.mocked(api.saveProfile).mock.calls.at(-1)?.[0].resources.mcpByTarget.opencode
    ).toEqual({ mode: "manage", selections: [] });
    vi.mocked(api.saveProfile).mockClear();

    fireEvent.click(screen.getByRole("switch", { name: "Turn off context7" }));
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
    const agentControlled = (await screen.findAllByText("Agent controlled"))[0];
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
    expect(screen.queryByRole("button", { name: "Remove override" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Agent controlled").length).toBeGreaterThanOrEqual(1);
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
    const refreshRequest = deferred<TargetInfo[]>();
    const api = installApi({
      listTargets: vi
        .fn()
        .mockResolvedValueOnce([target])
        .mockReturnValueOnce(refreshRequest.promise),
      listNativeMcpConnections: vi.fn()
        .mockResolvedValueOnce({ connections: [], issues: [] })
        .mockRejectedValueOnce(new Error("Optional MCP diagnostics unavailable"))
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    const agent = await screen.findByRole("article", { name: "Agent OpenCode" });
    expect(agent).toHaveTextContent("Ready");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(api.listTargets).toHaveBeenCalledTimes(2));
    expect(api.listTargets).toHaveBeenLastCalledWith(true);
    const refresh = screen.getByRole("button", { name: "Refresh" });
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("article", { name: "Agent OpenCode" })).toBe(agent);
    expect(agent).toHaveTextContent("Ready");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => {
      refreshRequest.resolve([refreshedTarget]);
      await refreshRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Agent OpenCode" })).toHaveTextContent("Missing")
    );
    expect(refresh).toHaveClass("ui-refresh-action--issue");
    expect(refresh).toHaveAttribute(
      "title",
      expect.stringContaining("Optional MCP diagnostics unavailable")
    );
    expect(screen.queryByText("Agents refreshed")).not.toBeInTheDocument();
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
      name: "Create Profile from OpenCode"
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

    expect(instructions).toHaveAccessibleDescription(/1 of 1 enabled/);
    expect(skills).toHaveAccessibleDescription(
      /2.*library-testing.*library-docs/
    );
    expect(mcp).toHaveAccessibleDescription(
      /Saved 4 · Agent 0.*library-docs.*shared-mcp.*raw-browser/
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
    const brokenRow = within(await openProfileSwitcher()).getByRole("option", { name: /broken-profile/ });
    expect(brokenRow).toHaveTextContent("Stored Profile data could not be loaded");

    fireEvent.click(brokenRow);

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
    const profileList = await openProfileSwitcher();
    const profileRows = within(profileList).getAllByRole("option");
    expect(profileRows[0]).toHaveTextContent("Profile B");
    expect(profileRows[1]).toHaveTextContent("Daily Coding");
    expect(within(profileRows[1] as HTMLElement).queryByText("Current")).not.toBeInTheDocument();

    const skillsRegion = await screen.findByRole("region", { name: "Profile Skills" });
    expect(within(skillsRegion).getByRole("switch", { name: "Disable Testing" })).toBeChecked();
    expect(within(skillsRegion).getByRole("switch", { name: "Enable Docs" })).not.toBeChecked();

    checkSkillLibraryUpdates.mockClear();
    fireEvent.click(
      within(skillsRegion).getByRole("button", { name: "Check Profile Skill updates" })
    );
    await waitFor(() =>
      expect(checkSkillLibraryUpdates).toHaveBeenCalledWith(["testing"])
    );

    fireEvent.click(within(skillsRegion).getByRole("switch", { name: "Disable Testing" }));
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(within(skillsRegion).getByRole("switch", { name: "Enable Testing" })).toBeEnabled();
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
    const pendingSave = deferred<ProfileDetail>();
    const api = installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget]),
      readProfile: vi.fn().mockResolvedValue(richProfile),
      saveProfile: vi.fn().mockReturnValue(pendingSave.promise),
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
    const profileList = await openProfileSwitcher();
    const row = within(profileList).getByRole("option", { name: /Daily Coding/ });
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row).not.toHaveTextContent("2 skills");
    expect(row).not.toHaveTextContent("3 MCP");
    expect(row).not.toHaveTextContent("1 file");
    expect(row).not.toHaveTextContent("Default developer environment");
    expect(within(row).getByLabelText("Codex · Active, OpenCode · Active")).toBeInTheDocument();
    expect(row).toHaveTextContent("2 Agents · Active");
    expect(screen.getByRole("status", { name: "Profile readiness" })).toHaveTextContent(
      "2 Agents · Active"
    );
    expect(document.querySelector(".profile-hero")).not.toHaveTextContent("Applied Jul 9");
    fireEvent.keyDown(document, { key: "Escape" });

    await editProfileInstructions("# Updated Agent\n");
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1));
    const dirtyRow = within(await openProfileSwitcher()).getByRole("option", { name: /Daily Coding/ });
    expect(dirtyRow.querySelector(".profile-row__dirty")).toHaveTextContent("Saving");
    pendingSave.resolve({
      ...richProfile,
      contentHash: "saved-profile-hash",
      targetContentHashes: richProfile.targetContentHashes
    });
    await waitFor(() => expect(dirtyRow.querySelector(".profile-row__dirty")).toBeNull());
  });

  it("keeps the only New Profile action in the temporary Profile switcher", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    const profileSwitcher = await openProfileSwitcher();
    const newProfileButtons = within(profileSwitcher).getAllByRole("button", { name: "New Profile" });
    expect(newProfileButtons).toHaveLength(1);
    expect(newProfileButtons[0].closest(".ui-object-switcher__footer")).not.toBeNull();
    expect(document.querySelector(".profile-index h2")).toBeNull();

    const edit = screen.getByRole("button", { name: "Edit Profile" });
    const more = screen.getByRole("button", { name: "More Profile actions" });
    expect(edit).toHaveAttribute("title", "Edit Profile");
    expect(more).toHaveAttribute("title", "More Profile actions");
    expect(more.closest(".profile-hero")).not.toBeNull();
    expect(more.closest(".profile-page-header")).toBeNull();
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
    const row = within(await openProfileSwitcher()).getByRole("option", { name: /Profile B/ });
    fireEvent.contextMenu(row, { clientX: 280, clientY: 220 });
    const menu = screen.getByRole("menu", { name: "Profile actions" });
    expect(menu).toHaveClass("profile-row-context-menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete Profile" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Profile" });
    expect(dialog).toHaveTextContent("Remove Profile B?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Profile" }));
    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("profile-b"));
    expect(await screen.findByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
  });

  it("restores the last selected Profile and its device-local order", async () => {
    const updateUiState = vi.fn().mockResolvedValue({
      version: 1,
      selectedProfileId: profileB.id,
      profileOrder: [profileB.id, profile.id],
      agentOrder: [],
      workspaceOrder: [],
      workspaceAgentSelections: {}
    });
    installApi({
      listProfiles: vi.fn().mockResolvedValue([summaryOf(profile), summaryOf(profileB)]),
      readProfile: vi.fn().mockImplementation(async (profileId) =>
        profileId === profileB.id ? profileB : profile
      ),
      readUiState: vi.fn().mockResolvedValue({
        version: 1,
        selectedProfileId: profileB.id,
        profileOrder: [profileB.id, profile.id],
        agentOrder: [],
        workspaceOrder: [],
        workspaceAgentSelections: {}
      }),
      updateUiState
    });
    render(<App />);

    await openProfiles();
    expect(await screen.findByRole("heading", { name: "Profile B" })).toBeInTheDocument();
    const switcher = await openProfileSwitcher();
    expect(within(switcher).getAllByRole("option").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Profile B"),
      expect.stringContaining("Daily Coding")
    ]);
    expect(updateUiState).not.toHaveBeenCalledWith({ selectedProfileId: profileB.id });
  });

  it("keeps Agent selection and Apply visible while secondary Profile actions stay in overflow", async () => {
    installApi();
    render(<App />);

    await openProfiles();
    const hero = document.querySelector(".profile-hero");
    expect(hero).not.toBeNull();
    const actions = within(document.querySelector(".profile-hero") as HTMLElement).getByRole("group", {
      name: "Selected Profile actions"
    });
    const applyButton = within(actions).getByRole("button", { name: "Apply" });
    expect(applyButton).toBeEnabled();
    expect(within(actions).queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Compare" })).not.toBeInTheDocument();
    expect(document.querySelector(".profile-hero [aria-label='More Profile actions']")).not.toBeNull();
    fireEvent.click(within(actions).getByRole("button", { name: "More Profile actions" }));
    expect(screen.getByRole("menuitem", { name: "Compare" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Restore last applied" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Profile Recovery" })).toBeEnabled();
  });

  it("restores the Profile baseline recorded by the selected Agent", async () => {
    const restoreAppliedProfile = vi.fn().mockResolvedValue(profile);
    installApi({
      listTargetStates: vi.fn().mockResolvedValue([
        managedState({
          appliedProfileSnapshot: {
            profileId: profile.id,
            profileName: profile.manifest.name,
            capturedAt: "2026-08-10T12:00:00.000Z",
            contentHash: "profile-hash",
            instructionsLength: profile.instructions.length,
            skillCount: 0,
            mcpCount: 0
          }
        })
      ]),
      restoreAppliedProfile
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "More Profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore last applied" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Restore last applied Profile"
    });
    expect(dialog).toHaveTextContent("last successfully applied to OpenCode");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore Profile" }));

    await waitFor(() => expect(restoreAppliedProfile).toHaveBeenCalledWith(
      profile.id,
      "opencode",
      "profile-hash"
    ));
  });

  it("auto-saves Profile identity and environment edits through one persistence owner", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    await editProfileInstructions("# Unsaved instructions\n");
    const row = within(await openProfileSwitcher()).getByRole("option", { name: /Daily Coding/ });
    expect(within(row).queryByRole("button", {
      name: "Change icon for Profile daily-coding"
    })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    const profileTrigger = within(document.querySelector(".profile-hero") as HTMLElement)
      .getByRole("button", { name: "Choose Profile" });
    expect(profileTrigger.querySelector(".ui-object-switcher__trigger-icon")).toBeNull();
    expect(document.querySelector(".profile-hero .ui-inspector-header__icon"))
      .not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Profile" }));
    const editDialog = await screen.findByRole("dialog", { name: "Edit Profile" });
    const icon = within(editDialog).getByRole("button", {
      name: "Change icon for Daily Coding"
    });
    expect(icon).toHaveAttribute("data-icon", "layers");
    fireEvent.click(icon);
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Icons for Daily Coding" })).getByRole(
        "menuitemradio",
        { name: "Design" }
      )
    );

    await waitFor(() => expect(
      vi.mocked(api.saveProfile).mock.calls.at(-1)?.[0]
    ).toMatchObject({
      manifest: expect.objectContaining({ iconKey: "palette" }),
      instructions: "# Unsaved instructions\n"
    }));
    expect(api.updateProfileMetadata).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(profileInstructionPreview()).toHaveTextContent("# Unsaved instructions");
  });

  it("auto-saves Profile changes and enables Apply after persistence", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    await editProfileInstructions("# Updated Agent\n");

    const applyButton = screen.getByRole("button", { name: "Apply" });
    expect(applyButton).toBeDisabled();
    fireEvent.click(applyButton);

    expect(api.previewApply).not.toHaveBeenCalled();
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(applyButton).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
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
      .toHaveTextContent("Unavailable");

    fireEvent.click(applyButton);

    await waitFor(() => expect(listTargets).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    const dialog = await screen.findByRole("dialog", { name: "Preview" });
    expect(dialog).not.toHaveTextContent("opencode CLI not found");
    expect(within(dialog).getByRole("button", { name: /^Apply$/ })).toBeEnabled();
  });

  it("keeps Compare in overflow and gates it while Profile auto-save is pending", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "More Profile actions" }));
    let compareButton = screen.getByRole("menuitem", { name: "Compare" });
    expect(compareButton).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    await editProfileInstructions("# Unsaved evaluation draft\n");

    fireEvent.click(screen.getByRole("button", { name: "More Profile actions" }));
    compareButton = screen.getByRole("menuitem", { name: "Compare" });
    expect(compareButton).toBeDisabled();
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
    await waitFor(() => expect(compareButton).toBeEnabled());
    expect(screen.queryByRole("dialog", { name: /Compare Daily Coding/ }))
      .not.toBeInTheDocument();
  });

  it("keeps isolated comparison unavailable when the platform write sandbox is unsupported", async () => {
    installApi({ platform: "win32" });
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("button", { name: "More Profile actions" }));
    const compareButton = screen.getByRole("menuitem", { name: "Compare" });
    expect(compareButton).toBeDisabled();
    expect(compareButton).toHaveAttribute(
      "title",
      "Isolated comparison currently requires macOS"
    );
  });

  it("keeps saving readiness informational and serializes duplicate save requests", async () => {
    const pendingSave = deferred<ProfileDetail>();
    const api = installApi({ saveProfile: vi.fn().mockReturnValue(pendingSave.promise) });
    render(<App />);

    await openProfiles();
    await editProfileInstructions("# Pending save\n");

    const readiness = screen.getByRole("status", { name: "Profile readiness" });
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledTimes(1));
    expect(readiness).toHaveTextContent(/Save|Saving/);
    expect(within(readiness).queryByRole("button")).toBeNull();
    fireEvent.keyDown(document, { key: "s", metaKey: true });
    fireEvent.keyDown(document, { key: "s", metaKey: true });

    expect(api.saveProfile).toHaveBeenCalledTimes(1);

    pendingSave.resolve({ ...profile, contentHash: "saved-profile-hash", targetContentHashes: { opencode: "saved-profile-hash" } });
    await waitFor(() => expect(readiness).toHaveTextContent("Ready to apply"));
  });

  it("prevents duplicate shortcut saves while persistence is pending", async () => {
    const pendingSave = deferred<ProfileDetail>();
    const api = installApi({ saveProfile: vi.fn().mockReturnValue(pendingSave.promise) });
    render(<App />);

    await openProfiles();
    await editProfileInstructions("# Pending shortcut save\n");

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    fireEvent.keyDown(document, { key: "s", metaKey: true });

    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    pendingSave.resolve({ ...profile, contentHash: "saved-profile-hash", targetContentHashes: { opencode: "saved-profile-hash" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled());
  });

  it("enables Apply as soon as Profile persistence finishes without a full refresh", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    await editProfileInstructions("# Fast save\n");
    vi.mocked(api.listTargets).mockClear();
    vi.mocked(api.listTargetStates).mockClear();
    vi.mocked(api.listProfiles).mockClear();
    vi.mocked(api.listBackups).mockClear();
    vi.mocked(api.scanSkillInventory).mockClear();
    vi.mocked(api.checkSkillLibraryUpdates).mockClear();

    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
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
    await editProfileInstructions("# Shortcut draft\n");

    fireEvent.keyDown(document, { key: "s", metaKey: true });

    expect(await screen.findByRole("alert")).toHaveTextContent("Profile storage is read-only");
    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(profileInstructionPreview()).toHaveTextContent("# Shortcut draft");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("ignores the whole-Profile save shortcut when the draft is clean", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "s", metaKey: true });

    expect(api.saveProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
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
    let profileList = await openProfileSwitcher();
    const profileOrder = () =>
      [...profileList.querySelectorAll(".profile-row__name")].map((item) => item.textContent);
    expect(profileOrder()).toEqual(["Codex Review", "Daily Coding"]);
    fireEvent.keyDown(document, { key: "Escape" });
    let menuButton = screen.getByRole("button", { name: "Select apply Agent" });
    expect(menuButton).toHaveTextContent("OpenCode");
    expect(menuButton).not.toHaveTextContent("Target:");
    menuButton.focus();
    fireEvent.click(menuButton);
    let menu = screen.getByRole("dialog", { name: "Select apply Agent" });
    const openCodeTarget = within(menu).getByRole("option", { name: "OpenCode" });
    const codexTargetItem = within(menu).getByRole("option", { name: "Codex" });
    expect(openCodeTarget).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(codexTargetItem).toHaveAttribute(
      "aria-selected",
      "false"
    );
    expect(openCodeTarget.querySelector("img")).toHaveClass(
      "agent-context-switcher__logo--opencode"
    );
    expect(codexTargetItem.querySelector("img")).toHaveClass(
      "agent-context-switcher__logo--codex"
    );
    expect(screen.getByRole("button", { name: "Apply" }).querySelector("img"))
      .toBeNull();
    expect(screen.getByRole("button", { name: "Apply" }).querySelector("svg"))
      .toBeNull();
    expect(screen.getByRole("button", { name: "Apply" }).querySelector(".ui-button__label"))
      .toHaveTextContent("Apply");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Select apply Agent" })).not.toBeInTheDocument();
    expect(menuButton).toHaveFocus();

    fireEvent.click(menuButton);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Select apply Agent" })).not.toBeInTheDocument();

    fireEvent.click(menuButton);
    menu = screen.getByRole("dialog", { name: "Select apply Agent" });
    fireEvent.click(within(menu).getByRole("option", { name: "Codex" }));
    expect(await screen.findByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
    profileList = await openProfileSwitcher();
    expect(within(profileList).getByText("Daily Coding")).toBeInTheDocument();
    expect(profileOrder()).toEqual(["Codex Review", "Daily Coding"]);

    fireEvent.click(within(profileList).getByRole("option", { name: /Codex Review/ }));
    await waitFor(() => expect(api.readProfile).toHaveBeenCalledWith("codex-review"));
    expect(await screen.findByRole("heading", { name: "Codex Review" })).toBeInTheDocument();
    profileList = await openProfileSwitcher();
    expect(profileOrder()).toEqual(["Codex Review", "Daily Coding"]);
    fireEvent.keyDown(document, { key: "Escape" });
    menuButton = screen.getByRole("button", { name: "Select apply Agent" });
    fireEvent.click(menuButton);
    expect(
      within(screen.getByRole("dialog", { name: "Select apply Agent" })).getByRole(
        "option",
        { name: "Codex" }
      )
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Select apply Agent" })).getByRole(
        "option",
        { name: "OpenCode" }
      )
    );
    profileList = await openProfileSwitcher();
    fireEvent.click(within(profileList).getByRole("option", { name: /Daily Coding/ }));
    menuButton = await screen.findByRole("button", { name: "Select apply Agent" });
    fireEvent.click(menuButton);
    expect(
      within(screen.getByRole("dialog", { name: "Select apply Agent" })).getByRole(
        "option",
        { name: "Codex" }
      )
    ).toHaveAttribute("aria-selected", "true");
  });

  it("preserves a dirty draft when the checked target is re-selected", async () => {
    const api = installApi({
      listTargets: vi.fn().mockResolvedValue([target, codexTarget])
    });
    render(<App />);

    await openProfiles();
    await editProfileInstructions("# Unsaved target-safe draft\n");

    const targetButton = screen.getByRole("button", { name: "Select apply Agent" });
    targetButton.focus();
    fireEvent.click(targetButton);
    const checkedTarget = screen.getByRole("option", { name: "OpenCode" });
    expect(checkedTarget).toHaveAttribute("aria-selected", "true");
    fireEvent.click(checkedTarget);

    expect(screen.queryByRole("dialog", { name: "Select apply Agent" })).not.toBeInTheDocument();
    expect(targetButton).toHaveFocus();
    expect(await screen.findByRole("heading", { name: "Daily Coding" })).toBeInTheDocument();
    expect(profileInstructionPreview()).toHaveTextContent("# Unsaved target-safe draft");
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
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
    fireEvent.click(within(screen.getByRole("region", { name: "Profile composer" }))
      .getByRole("button", { name: "Instructions" }));
    expect(profileInstructionPreview()).toHaveTextContent("# Agent");

    deferProfileB = true;
    const profileList = await openProfileSwitcher();
    fireEvent.click(within(profileList).getByRole("option", { name: /Profile B/ }));

    expect(screen.queryByRole("heading", { name: "Daily Coding" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Profile composer" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Preview of AGENTS.md")).not.toBeInTheDocument();

    await act(async () => {
      profileBRead.resolve(profileB);
      await profileBRead.promise;
    });
    expect(await screen.findByRole("heading", { name: "Profile B" })).toBeInTheDocument();
    const composer = screen.getByRole("region", { name: "Profile composer" });
    fireEvent.click(within(composer).getByRole("button", { name: "Instructions" }));
    expect(profileInstructionPreview()).toHaveTextContent("# Profile B");
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
    let profileList = await openProfileSwitcher();
    fireEvent.click(within(profileList).getByRole("option", { name: /Profile B/ }));
    profileList = await openProfileSwitcher();
    fireEvent.click(within(profileList).getByRole("option", { name: /Profile C/ }));

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
      within(await openProfileSwitcher()).getByRole("option", { name: /Profile C/ })
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(screen.getByRole("region", { name: "Profile composer" }))
      .getByRole("button", { name: "Instructions" }));
    expect(profileInstructionPreview()).toHaveTextContent("# Profile C");
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
    let profileList = await openProfileSwitcher();
    fireEvent.click(within(profileList).getByRole("option", { name: /Profile B/ }));
    profileList = await openProfileSwitcher();
    fireEvent.click(within(profileList).getByRole("option", { name: /Profile C/ }));

    await act(async () => {
      profileBRead.resolve(profileB);
      await profileBRead.promise;
    });
    expect(screen.getByRole("status", { name: "Loading Profile Profile C" }))
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
    const profileList = await openProfileSwitcher();
    fireEvent.click(within(profileList).getByRole("option", { name: /Profile C/ }));
    await act(async () => {
      stalePreview.resolve({ ...preview, profileId: profileB.id });
      await stalePreview.promise;
    });

    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading Profile Profile C" }))
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
    const moreButton = screen.getByRole("button", { name: "More Profile actions" });

    fireEvent.click(targetButton);
    expect(screen.getByRole("dialog", { name: "Select apply Agent" })).toBeInTheDocument();
    fireEvent.click(moreButton);
    expect(screen.queryByRole("dialog", { name: "Select apply Agent" })).not.toBeInTheDocument();
    expect(screen.getByRole("menu", { name: "Profile actions" })).toBeInTheDocument();

    fireEvent.click(targetButton);
    expect(screen.queryByRole("menu", { name: "Profile actions" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Select apply Agent" })).toBeInTheDocument();

    fireEvent.click(moreButton);
    moreButton.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Profile actions" })).not.toBeInTheDocument();
    expect(moreButton).toHaveFocus();

    fireEvent.click(moreButton);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate Profile" }));
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
    expect(readiness).toHaveTextContent("Ready to apply");
    let action = screen.getByRole("button", { name: "Apply" });
    expect(action).toHaveAttribute("title", "Take over OpenCode");
    fireEvent.click(action);
    await waitFor(() => expect(readyApi.previewApply).toHaveBeenCalledWith("daily-coding", "opencode"));
    let dialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(dialog).getByRole("button", { name: /^Apply$/ })).toBeEnabled();
    expect(readyApi.applyProfile).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review local Skills" }));
    const localSkills = await screen.findByRole("region", { name: "Local Skills Manager" });
    expect(localSkills).toHaveTextContent("All local Skills on this device");
    expect(localSkills).toHaveTextContent("Opened from OpenCode");
    expect(within(localSkills).queryByRole("combobox", { name: "Management scope" }))
      .not.toBeInTheDocument();
    fireEvent.click(within(localSkills).getByRole("button", { name: "Close library tool" }));
    await waitFor(() => expect(readyApi.previewApply).toHaveBeenCalledTimes(2));
    dialog = await screen.findByRole("dialog", { name: "Preview" });
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
    expect(readiness).toHaveTextContent("Ready to apply");
    action = document.querySelector<HTMLButtonElement>(".profile-apply-button")!;
    expect(action).toHaveAttribute("title", "Preview & apply to OpenCode");

    cleanup();
    installApi({ listProfiles: vi.fn().mockResolvedValue([]) });
    render(<App />);
    await openProfiles();
    expect(screen.queryByRole("status", { name: "Profile readiness" })).toBeNull();
    action = screen.getByRole("button", { name: "Apply" });
    expect(action).toBeDisabled();
    expect(action).toHaveAccessibleDescription("Select a Profile before previewing changes");

    cleanup();
    installApi({ listTargets: vi.fn().mockResolvedValue([]) });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Select an Agent");
    expect(screen.getByRole("button", { name: "Select apply Agent" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Open Agents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Apply" })).not.toBeInTheDocument();

    cleanup();
    const unavailableApi = installApi({
      listTargets: vi.fn().mockResolvedValue([unavailableTarget])
    });
    render(<App />);
    await openProfiles();
    readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Unavailable");
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
    expect(readiness).toHaveTextContent("Ready to apply");
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
    expect(readiness).toHaveTextContent("Needs review");
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
      "Up to date"
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
      "Needs review"
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

    fireEvent.click(screen.getByRole("button", { name: "More Profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Profile" }));

    const deleteDialog = screen.getByRole("dialog", { name: "Delete Profile" });
    expect(deleteDialog).toHaveTextContent("OpenCode, Codex");
    expect(deleteDialog).toHaveTextContent("Apply another Profile or stop managing each Agent");
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
      within(targetCard).getByRole("button", { name: "OpenCode" })
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
      within(targetCard).getByRole("button", { name: "Codex" })
    );

    await screen.findByRole("region", { name: "Profiles" });
    fireEvent.click(screen.getByRole("button", { name: "Select apply Agent" }));
    const menu = screen.getByRole("dialog", { name: "Select apply Agent" });
    expect(
      within(menu).getByRole("option", { name: "Codex" })
    ).toHaveAttribute("aria-selected", "true");
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
      warnings: [
        "OpenCode native settings remain Agent-owned",
        "opencode.jsonc.theme"
      ],
      errors: []
    };
    const api = installApi({
      platform: "win32",
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
      within(targetCard).getByRole("button", { name: "OpenCode" })
    );
    let dialog = screen.getByRole("dialog", { name: "Create Profile from OpenCode" });
    expect(dialog).toHaveTextContent("Save the current Agent setup as a reusable Profile");
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));

    await waitFor(() =>
      expect(api.previewCreateProfileFromTarget).toHaveBeenCalledWith(
        "opencode",
        "all"
      )
    );
    dialog = screen.getByRole("dialog", { name: "Review OpenCode capture" });
    expect(dialog).toHaveTextContent("2 items will remain outside AgentEnv");
    expect(within(dialog).getByLabelText("Capture summary")).toHaveTextContent(
      "0Profile resources"
    );
    expect(within(dialog).queryByText("opencode.jsonc.theme")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", {
      name: /2 items will remain outside AgentEnv/
    }));
    expect(within(dialog).getByText("opencode.jsonc.theme")).toBeInTheDocument();
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
    const diagnostics = screen.getByRole("region", { name: "OpenCode diagnostics" });
    expect(within(diagnostics).getByText("Detected via")).toBeInTheDocument();
    expect(within(diagnostics).getByText("opencode command")).toBeInTheDocument();
    expect(within(diagnostics).getByText("Runtime")).toBeInTheDocument();
    expect(within(diagnostics).getByText("Command detected")).toBeInTheDocument();
    expect(within(diagnostics).getByText("/usr/local/bin/opencode")).toBeInTheDocument();
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

  it("distinguishes a Codex runtime bundled with ChatGPT from a shell command", async () => {
    const bundledCodexTarget: TargetInfo = {
      ...codexTarget,
      health: {
        ...codexTarget.health,
        installationEvidence: [{
          kind: "desktop-app",
          label: "ChatGPT app",
          path: "/Applications/ChatGPT.app"
        }],
        executableName: "codex",
        executableCandidates: ["codex"],
        executableCandidate: undefined,
        executablePath: "/Applications/ChatGPT.app/Contents/Resources/codex",
        executableSource: "bundled-runtime",
        executableVersion: "codex-cli 0.148.0-alpha.9"
      }
    };
    installApi({
      listTargets: vi.fn().mockResolvedValue([bundledCodexTarget]),
      listSupportedTargets: vi.fn().mockResolvedValue([bundledCodexTarget]),
      probeSupportedTargets: vi.fn().mockResolvedValue([bundledCodexTarget])
    });
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    fireEvent.click(screen.getByRole("button", { name: "More actions for Codex" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Diagnostics" }));
    const diagnostics = screen.getByRole("region", { name: "Codex diagnostics" });

    expect(within(diagnostics).getByText("ChatGPT app")).toBeInTheDocument();
    expect(within(diagnostics).getByText("Bundled with app")).toBeInTheDocument();
    expect(within(diagnostics).getByText(/codex-cli 0\.148\.0-alpha\.9/)).toBeInTheDocument();
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
    expect(within(confirmDialog).getByRole("button", { name: "Cancel" }))
      .toHaveClass("ui-button--secondary");
    const confirmRestore = within(confirmDialog).getByRole("button", { name: "Restore data" });
    expect(confirmRestore).toHaveClass("ui-button--danger");
    fireEvent.click(confirmRestore);
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

    fireEvent.click(screen.getByRole("button", { name: "Edit Profile" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit Profile" });
    expect(editDialog.parentElement).toHaveAttribute(
      "data-dismiss-policy",
      "intentional"
    );
    fireEvent.change(within(editDialog).getByLabelText("Profile name"), {
      target: { value: "" }
    });
    fireEvent.click(editDialog.parentElement!);
    expect(screen.getByRole("dialog", { name: "Edit Profile" })).toBeInTheDocument();
    expect(within(editDialog).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Edit Profile" })).toBeInTheDocument();
    fireEvent.change(within(editDialog).getByLabelText("Profile name"), {
      target: { value: "Review Focus" }
    });
    fireEvent.change(within(editDialog).getByLabelText("Description"), {
      target: { value: "Review and quality checks" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({
          name: "Review Focus",
          description: "Review and quality checks"
        })
      })
    ));
    await waitFor(() => expect(screen.queryByText("Saving...")).not.toBeInTheDocument());
    expect(screen.queryByText("Profile saved")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(api.updateProfileMetadata).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "More Profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate Profile" }));
    await waitFor(() => expect(api.duplicateProfile).toHaveBeenCalledWith("daily-coding"));

    await clickNewProfile();
    const createDialog = screen.getByRole("dialog", { name: "New Profile" });
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

    fireEvent.click(screen.getByRole("button", { name: "More Profile actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Profile" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete Profile" });
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Remove Profile" }));

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

    await clickNewProfile();
    let dialog = screen.getByRole("dialog", { name: "New Profile" });
    fireEvent.click(within(dialog).getByRole("button", { name: "From Agent" }));
    dialog = screen.getByRole("dialog", { name: "Create Profile from OpenCode" });
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
    dialog = screen.getByRole("dialog", { name: "Create Profile from OpenCode" });
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
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeEnabled();
  });

  it("resolves conflicting active Skill copies inside Capture and exports its operation report", async () => {
    const capturedProfile: ProfileDetail = {
      ...profile,
      id: "captured-opencode",
      manifest: {
        ...profile.manifest,
        id: "captured-opencode",
        name: "OpenCode"
      }
    };
    const api = installApi({
      previewCreateProfileFromTarget: vi.fn().mockResolvedValue({
        id: "capture-conflict-preview",
        targetId: "opencode",
        targetName: "OpenCode",
        scope: "all",
        suggestedName: "OpenCode",
        createdAt: "2026-08-04T00:00:00.000Z",
        resources: [],
        issues: [{
          id: "skill-conflict:review-helper",
          code: "conflicting-skill-copies",
          severity: "decision",
          skillName: "review-helper",
          message: "2 active copies have different content",
          diagnosticReference: "AEM-20260804-ABC123",
          candidates: [
            {
              id: "preferred",
              path: "/tmp/home/.config/opencode/skills/review-helper",
              canonicalPath: "/tmp/home/.config/opencode/skills/review-helper",
              version: "2.0.0",
              contentHash: "a".repeat(64),
              modifiedAt: "2026-08-03T00:00:00.000Z",
              locationRole: "preferred-runtime",
              shared: false,
              comparisonChanges: []
            },
            {
              id: "shared",
              path: "/tmp/home/.agents/skills/review-helper",
              canonicalPath: "/tmp/home/.agents/skills/review-helper",
              version: "1.0.0",
              contentHash: "b".repeat(64),
              locationRole: "compatibility-runtime",
              shared: true,
              comparisonBaseId: "preferred",
              comparisonChanges: [{
                path: "SKILL.md",
                before: "# Preferred\n",
                after: "# Shared\n",
                diff: "-# Preferred\n+# Shared\n"
              }]
            }
          ]
        }],
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

    await clickNewProfile();
    fireEvent.click(within(screen.getByRole("dialog", { name: "New Profile" }))
      .getByRole("button", { name: "From Agent" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create Profile from OpenCode" }))
      .getByRole("button", { name: "Review" }));

    const dialog = await screen.findByRole("dialog", { name: "Review OpenCode capture" });
    const save = within(dialog).getByRole("button", { name: "Save Profile" });
    expect(save).toBeDisabled();
    expect(within(dialog).getByText("Choose which copies to save")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/home/.agents/skills/review-helper")
    ));
    fireEvent.click(within(dialog).getByRole("button", { name: "Export report" }));
    await waitFor(() => expect(api.exportDiagnostics).toHaveBeenCalledWith(
      "AEM-20260804-ABC123"
    ));
    fireEvent.click(within(dialog).getByRole("radio", {
      name: /Agent-specific location.*2\.0\.0/
    }));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.createProfileFromTarget).toHaveBeenCalledWith({
      previewId: "capture-conflict-preview",
      name: "OpenCode",
      decisions: [{
        issueId: "skill-conflict:review-helper",
        action: "use-copy",
        candidateId: "preferred"
      }]
    }));
  });

  it("keeps a true Capture stop actionable inside the review dialog", async () => {
    const api = installApi({
      previewCreateProfileFromTarget: vi.fn().mockResolvedValue({
        id: "capture-blocked-preview",
        targetId: "opencode",
        targetName: "OpenCode",
        scope: "all",
        suggestedName: "OpenCode",
        createdAt: "2026-08-04T00:00:00.000Z",
        resources: [],
        issues: [],
        warnings: [],
        errors: ["Skill invalid name cannot be captured because its directory name is invalid"],
        blockingDiagnosticReference: "AEM-20260804-DEF456"
      })
    });
    render(<App />);
    await openProfiles();

    await clickNewProfile();
    fireEvent.click(within(screen.getByRole("dialog", { name: "New Profile" }))
      .getByRole("button", { name: "From Agent" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Create Profile from OpenCode" }))
      .getByRole("button", { name: "Review" }));

    const dialog = await screen.findByRole("dialog", { name: "Review OpenCode capture" });
    expect(within(dialog).getByText("Capture is blocked")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save Profile" })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(api.copyText).toHaveBeenCalledWith(
      expect.stringContaining("AEM-20260804-DEF456")
    ));
    fireEvent.click(within(dialog).getByRole("button", { name: "Export report" }));
    await waitFor(() => expect(api.exportDiagnostics).toHaveBeenCalledWith(
      "AEM-20260804-DEF456"
    ));
  });

  it("keeps the Targets workspace and restores context when capture is cancelled", async () => {
    installApi();
    render(<App />);

    await screen.findByRole("region", { name: "Agents" });
    const targetsWorkspace = await screen.findByRole("region", { name: "Agents" });
    const targetCard = within(targetsWorkspace).getByRole("article", { name: "Agent OpenCode" });
    fireEvent.click(within(targetCard).getByRole("button", { name: "OpenCode" }));

    const dialog = screen.getByRole("dialog", { name: "Create Profile from OpenCode" });
    expect(screen.getByRole("region", { name: "Agents" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Create Profile from OpenCode" })).not.toBeInTheDocument();
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

    await clickNewProfile();
    fireEvent.click(screen.getByRole("button", { name: "From Agent" }));
    let dialog = screen.getByRole("dialog", { name: "Create Profile from OpenCode" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review" }));

    const localError = await within(dialog).findByRole("alert");
    expect(localError).toHaveTextContent("Agent changed while it was being reviewed");
    expect(screen.queryByText("Action failed")).not.toBeInTheDocument();
    fireEvent.click(within(localError).getByRole("button", { name: "Refresh review" }));

    dialog = await screen.findByRole("dialog", { name: "Review OpenCode capture" });
    expect(api.previewCreateProfileFromTarget).toHaveBeenCalledTimes(2);
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flushes Profile auto-save before context-changing actions without prompting", async () => {
    const api = installApi();
    render(<App />);
    await openProfiles();

    await editProfileInstructions("# Auto-save guard\n");
    await clickNewProfile();
    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
    expect(await screen.findByRole("dialog", { name: "New Profile" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("preserves a Profile edit and offers retry when auto-save fails", async () => {
    installApi({ saveProfile: vi.fn().mockRejectedValue(new Error("Save failed")) });
    render(<App />);
    await openProfiles();

    await editProfileInstructions("# Keep this draft\n");
    await screen.findByRole("alert");
    const readiness = screen.getByRole("status", { name: "Profile readiness" });
    expect(readiness).toHaveTextContent("Changes could not be saved");
    expect(screen.getByRole("button", { name: "Retry save" })).toBeInTheDocument();
    await clickNewProfile();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved changes" })).getByRole(
        "button",
        { name: "Retry and continue" }
      )
    );

    await screen.findByRole("alert");
    expect(screen.getByRole("dialog", { name: "Unsaved changes" })).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Unsaved changes" })).getByRole(
        "button",
        { name: "Keep editing" }
      )
    );
    expect(profileInstructionPreview()).toHaveTextContent("# Keep this draft");
  });

  it("flushes Profile auto-save before an Electron window close", async () => {
    let requestClose = () => undefined;
    const api = installApi({
      onWindowCloseRequested: vi.fn().mockImplementation((callback) => {
        requestClose = callback;
        return () => undefined;
      })
    });
    render(<App />);
    await openProfiles();

    await editProfileInstructions("# Unsaved before close\n");
    await waitFor(() => expect(api.setWindowCloseGuard).toHaveBeenLastCalledWith(true));
    act(() => requestClose());

    await waitFor(() => expect(api.saveProfile).toHaveBeenCalled());
    await waitFor(() => expect(api.confirmWindowClose).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("cancels an operating-system quit request when failed Profile recovery is dismissed", async () => {
    let requestClose = () => undefined;
    const api = installApi({
      saveProfile: vi.fn().mockRejectedValue(new Error("Storage unavailable")),
      onWindowCloseRequested: vi.fn().mockImplementation((callback) => {
        requestClose = callback;
        return () => undefined;
      })
    });
    render(<App />);
    await openProfiles();

    await editProfileInstructions("# Keep this draft open\n");
    await screen.findByRole("alert");
    act(() => requestClose());
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Unsaved changes" })).getByRole(
        "button",
        { name: "Keep editing" }
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
    fireEvent.click(screen.getByRole("button", { name: "Recovery" }));
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
