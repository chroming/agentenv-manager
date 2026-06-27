// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import type { AgentEnvApi, ProfileDetail } from "../../src/shared/types";

const profile: ProfileDetail = {
  id: "daily-coding",
  profileDir: "/tmp/profiles/daily-coding",
  manifest: {
    id: "daily-coding",
    name: "Daily Coding",
    description: "Default",
    version: 1,
    managed: { agents: true, mcp: true, skills: true }
  },
  agentsMd: "# Agent\n",
  mcpToml: '[mcp_servers.context7]\ncommand = "npx"\n',
  skillsPolicy: {
    ownedSkillDirs: [],
    disabledSkillPaths: []
  }
};

const installApi = (overrides: Partial<AgentEnvApi> = {}) => {
  const api: AgentEnvApi = {
    listProfiles: vi
      .fn()
      .mockResolvedValue([{ id: "daily-coding", name: "Daily Coding", description: "Default" }]),
    readProfile: vi.fn().mockResolvedValue(profile),
    saveProfile: vi.fn().mockImplementation(async (input) => ({
      ...profile,
      ...input,
      id: input.manifest.id
    })),
    previewApply: vi.fn().mockResolvedValue({
      id: "preview-1",
      profileId: "daily-coding",
      createdAt: "2026-06-30T00:00:00.000Z",
      warnings: [],
      errors: [],
      changes: [],
      liveFingerprints: {}
    }),
    applyProfile: vi.fn().mockResolvedValue({ ok: true, backupId: "backup-1" }),
    listBackups: vi.fn().mockResolvedValue([]),
    previewRollback: vi.fn().mockResolvedValue({
      id: "rollback-1",
      backupId: "backup-1",
      createdAt: "2026-06-30T00:00:00.000Z",
      warnings: [],
      errors: [],
      changes: []
    }),
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
    expect(screen.getByLabelText("MCP Servers")).toHaveValue(
      '[mcp_servers.context7]\ncommand = "npx"\n'
    );
  });

  it("previews the selected profile before apply is enabled", async () => {
    const api = installApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /Daily Coding/ }));
    const applyButton = await screen.findByRole("button", { name: "Apply" });
    expect(applyButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => expect(api.previewApply).toHaveBeenCalledWith("daily-coding"));
    expect(applyButton).toBeEnabled();
  });
});
