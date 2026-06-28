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
import { App } from "../../src/renderer/App";
import type { AgentEnvApi, ProfileDetail, TargetInfo } from "../../src/shared/types";

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
  }
};

const preview = {
  id: "preview-1",
  profileId: "daily-coding",
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
  liveFingerprints: {},
  targetState: { managedConfigKeys: [], managedMcpNames: [] }
};

const backup = {
  id: "2026-06-30T09-19-41-374Z",
  createdAt: "2026-06-30T09:19:41.374Z",
  fileCount: 2
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

const installApi = (overrides: Partial<AgentEnvApi> = {}) => {
  const api: AgentEnvApi = {
    selectSkillFolder: vi.fn().mockResolvedValue(undefined),
    listTargets: vi.fn().mockResolvedValue([target]),
    listTargetStates: vi.fn().mockResolvedValue([]),
    listSkillLibrary: vi.fn().mockResolvedValue([]),
    scanSkillInventory: vi.fn().mockResolvedValue([]),
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
    removeSkillFromLibrary: vi.fn().mockResolvedValue(undefined),
    checkSkillLibraryUpdates: vi.fn().mockResolvedValue([]),
    manageTargetSkill: vi.fn().mockResolvedValue(undefined),
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
      skillAutoCheckIntervalMinutes: 60,
      githubOAuthClientId: "client-123"
    }),
    updateSettings: vi.fn().mockImplementation(async (input) => ({
      skillSyncMethod: input.skillSyncMethod ?? "symlink",
      skillStorageLocation: input.skillStorageLocation ?? "appData",
      skillAutoCheckEnabled: input.skillAutoCheckEnabled ?? true,
      skillAutoCheckIntervalMinutes: input.skillAutoCheckIntervalMinutes ?? 60,
      githubOAuthClientId: input.githubOAuthClientId ?? "client-123"
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
          description: "Default"
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
  const openProfiles = async () => {
    await screen.findByRole("region", { name: "Library workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
  };

  it("loads profiles and shows the selected profile", async () => {
    const api = installApi();
    const { container } = render(<App />);

    await openProfiles();
    const brandIcon = container.querySelector<HTMLImageElement>(".brand-icon");
    expect(brandIcon).toBeInTheDocument();
    expect(brandIcon?.getAttribute("src")).toContain("app-icon");
    expect(await screen.findByRole("region", { name: "Profile overview" })).toBeInTheDocument();
    expect(api.readProfile).toHaveBeenCalledWith("daily-coding");
    expect(screen.getByRole("button", { name: "Take over OpenCode" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Target readiness" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Resources" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skills" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Skill Library" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Assets" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.click(screen.getByRole("tab", { name: "Instructions" }));
    expect(screen.getByLabelText("AGENTS.md")).toHaveValue("# Agent\n");
    fireEvent.click(screen.getByRole("tab", { name: "Config" }));
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
      intervalCallback = callback as () => void;
      expect(timeout).toBe(5 * 60 * 1000);
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
    expect(setIntervalSpy).toHaveBeenCalled();
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
    fireEvent.change(screen.getByLabelText("GitHub OAuth Client ID"), {
      target: { value: "client-abc" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with GitHub" }));

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({ githubOAuthClientId: "client-abc" })
    );
    await waitFor(() => expect(screen.getByText("ABCD-1234")).toBeInTheDocument());
    expect(api.openGitHubDevicePage).toHaveBeenCalledWith("https://github.com/login/device");

    fireEvent.click(screen.getByRole("button", { name: "Complete sign in" }));

    await waitFor(() => expect(api.pollGitHubDeviceLogin).toHaveBeenCalledWith("login-1"));
    await waitFor(() => expect(screen.getAllByText("Signed in as octocat")).toHaveLength(2));
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
  });

  it("shows a safe activation inspector and enables apply after preview", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    const applyButton = await screen.findByRole("button", { name: "Take over OpenCode" });
    expect(applyButton).toBeEnabled();

    fireEvent.click(applyButton);

    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding"));
    const previewDialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(previewDialog).getByText("2 files in this diff")).toBeInTheDocument();
    expect(within(previewDialog).getByText("Will keep")).toBeInTheDocument();
    expect(within(previewDialog).getByText("Will replace")).toBeInTheDocument();
    expect(within(previewDialog).getByText("Will install")).toBeInTheDocument();
    expect(within(previewDialog).getAllByText("/tmp/home/.config/opencode/AGENTS.md").length).toBeGreaterThan(0);
    expect(within(previewDialog).getByRole("button", { name: "Confirm" })).toBeEnabled();

    fireEvent.click(within(previewDialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument();
  });

  it("shows managed target state and uses Apply after takeover", async () => {
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

    await openProfiles();

    expect(await screen.findByRole("button", { name: "Apply to OpenCode" })).toBeInTheDocument();
    expect(screen.getByText("OpenCode is managed")).toBeInTheDocument();
    expect(screen.getByText("Active profile: Daily Coding")).toBeInTheDocument();
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
    expect(within(openCodeCard).getByText("Active profile: Daily Coding")).toBeInTheDocument();
    expect(within(openCodeCard).getByText("3 managed resources")).toBeInTheDocument();
  });

  it("uses clearer preview wording for drifted managed content", async () => {
    installApi({
      previewApply: vi.fn().mockResolvedValue({
        ...preview,
        warnings: [],
        errors: [
          "External changes detected in AgentEnv-managed instructions instructions: /tmp/home/.config/opencode/AGENTS.md"
        ]
      })
    });
    render(<App />);

    await openProfiles();
    fireEvent.click(await screen.findByRole("button", { name: "Take over OpenCode" }));

    const previewDialog = await screen.findByRole("dialog", { name: "Preview" });
    expect(within(previewDialog).getByText("Blocked")).toBeInTheDocument();
    expect(within(previewDialog).getByText("OpenCode instructions changed outside AgentEnv")).toBeInTheDocument();
    expect(within(previewDialog).getAllByText("/tmp/home/.config/opencode/AGENTS.md").length).toBeGreaterThan(0);
  });

  it("keeps profile edits in a draft until the page-level save button is clicked", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();
    fireEvent.click(screen.getByRole("tab", { name: "Instructions" }));
    fireEvent.change(screen.getByLabelText("AGENTS.md"), {
      target: { value: "# Updated Agent\n" }
    });

    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(api.saveProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Take over OpenCode" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Save profile before applying");
    expect(api.previewApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(api.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: "# Updated Agent\n"
        })
      )
    );
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Profile saved"));

    fireEvent.click(screen.getByRole("button", { name: "Take over OpenCode" }));
    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding"));
  });

  it("dismisses profile modals and menus with Escape or outside clicks", async () => {
    installApi();
    render(<App />);

    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Take over OpenCode" }));
    await screen.findByRole("dialog", { name: "Preview" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Preview" })).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit profile details" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit profile" });
    fireEvent.click(editDialog.parentElement!);
    expect(screen.queryByRole("dialog", { name: "Edit profile" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select apply target" }));
    expect(screen.getByRole("menu", { name: "Profile targets" })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Profile targets" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More profile actions" }));
    expect(screen.getByRole("menu", { name: "Profile actions" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Profile actions" })).not.toBeInTheDocument();
  });

  it("creates, edits, duplicates, and deletes profiles from the profile workspace", async () => {
    const api = installApi();
    render(<App />);

    await openProfiles();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile details" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit profile" });
    fireEvent.change(within(editDialog).getByLabelText("Profile name"), {
      target: { value: "Review Focus" }
    });
    fireEvent.change(within(editDialog).getByLabelText("Description"), {
      target: { value: "Review and quality checks" }
    });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    expect(api.saveProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

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
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.deleteProfile).toHaveBeenCalledWith("opencode-created"));
  });

  it("keeps apply disabled when target discovery says writes are blocked", async () => {
    const api = installApi({
      listTargets: vi.fn().mockResolvedValue([
        {
          ...target,
          health: {
            ...target.health,
            status: "missing",
            executableFound: false,
            executablePath: undefined,
            canWrite: false,
            summary: "opencode CLI not found"
          }
        }
      ])
    });
    render(<App />);

    await openProfiles();
    const applyButton = await screen.findByRole("button", { name: "Take over OpenCode" });

    fireEvent.click(applyButton);

    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding"));
    const previewDialog = screen.getByRole("dialog", { name: "Preview" });
    expect(within(previewDialog).getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("previews and restores a backup from history", async () => {
    const api = installApi({
      listBackups: vi.fn().mockResolvedValue([backup])
    });
    render(<App />);

    await openProfiles();
    const history = await screen.findByRole("region", { name: "History" });
    fireEvent.click(
      within(history).getByRole("button", {
        name: `Preview rollback ${backup.id}`
      })
    );

    await waitFor(() => expect(api.previewRollback).toHaveBeenCalledWith(backup.id));
    expect(screen.getByText("Rollback preview")).toBeInTheDocument();
    expect(screen.getAllByText("/tmp/home/.config/opencode/AGENTS.md").length).toBeGreaterThan(0);

    fireEvent.click(within(history).getByRole("button", { name: "Restore backup" }));

    await waitFor(() => expect(api.rollback).toHaveBeenCalledWith(backup.id));
    expect(screen.queryByText("Rollback preview")).not.toBeInTheDocument();
  });
});
