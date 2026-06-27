// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
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
    disabledSkillPaths: []
  }
};

const preview = {
  id: "preview-1",
  profileId: "daily-coding",
  targetId: "opencode",
  createdAt: "2026-06-30T00:00:00.000Z",
  warnings: [],
  errors: [],
  changes: [
    {
      path: "/tmp/home/.config/opencode/AGENTS.md",
      before: "# Old\n",
      after: "# Agent\n",
      diff: "--- AGENTS.md\n+++ AGENTS.md\n@@\n-# Old\n+# Agent\n"
    },
    {
      path: "/tmp/home/.config/opencode/opencode.json",
      before: "{}\n",
      after: '{\n  "mcp": {}\n}\n',
      diff: "--- opencode.json\n+++ opencode.json\n@@\n-{}\n+{\"mcp\":{}}\n"
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
  configLabel: "opencode.json",
  configLanguage: "jsonc",
  realWritesEnabled: true,
  executableName: "opencode",
  paths: {
    targetId: "opencode",
    configDir: "/tmp/home/.config/opencode",
    instructionsPath: "/tmp/home/.config/opencode/AGENTS.md",
    configPath: "/tmp/home/.config/opencode/opencode.json",
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
    listTargets: vi.fn().mockResolvedValue([target]),
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
    createProfile: vi.fn().mockResolvedValue(profile),
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
});

describe("App", () => {
  it("loads profiles and shows the selected profile", async () => {
    installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Daily Coding/ }));

    expect(await screen.findByLabelText("AGENTS.md")).toHaveValue("# Agent\n");
    expect(
      within(screen.getByRole("region", { name: "Target status" })).getByText("Ready")
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Target status" })).getByText(
        "/tmp/home/.config/opencode"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Resources" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Skills" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Assets" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Instructions" })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    fireEvent.click(screen.getByRole("tab", { name: "Config" }));
    expect(screen.getByLabelText("opencode.json")).toHaveValue('{\n  "mcp": {}\n}\n');
  });

  it("shows a safe activation inspector and enables apply after preview", async () => {
    const api = installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Daily Coding/ }));
    const applyButton = await screen.findByRole("button", { name: "Apply to OpenCode" });
    expect(applyButton).toBeDisabled();
    expect(screen.getByText("Preview required")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding"));
    expect(screen.getByText("Ready to apply")).toBeInTheDocument();
    expect(screen.getByText("2 files will change")).toBeInTheDocument();
    expect(screen.getAllByText("/tmp/home/.config/opencode/AGENTS.md").length).toBeGreaterThan(0);
    expect(applyButton).toBeEnabled();
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

    fireEvent.click(await screen.findByRole("button", { name: /Daily Coding/ }));
    const applyButton = await screen.findByRole("button", { name: "Apply to OpenCode" });

    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));

    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding"));
    expect(screen.getByText("Target blocked")).toBeInTheDocument();
    expect(applyButton).toBeDisabled();
  });

  it("previews and restores a backup from history", async () => {
    const api = installApi({
      listBackups: vi.fn().mockResolvedValue([backup])
    });
    render(<App />);

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
    expect(screen.getByText("Preview required")).toBeInTheDocument();
  });
});
