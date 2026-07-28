// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileMcpEditor } from "../../src/renderer/components/ProfileMcpEditor";
import type { ProfileResources, TargetInfo } from "../../src/shared/types";

const target: TargetInfo = {
  id: "opencode",
  name: "OpenCode",
  description: "Manage OpenCode.",
  iconKey: "opencode",
  instructionsLabel: "AGENTS.md",
  configLabel: "opencode.jsonc",
  configLanguage: "jsonc",
  realWritesEnabled: true,
  executableName: "opencode",
  capabilities: {
    instructions: true,
    skills: true,
    mcpTransports: ["stdio"],
    agentFormat: "opencode",
    disabledSkillPaths: false,
    mcpActivation: true
  },
  paths: {
    targetId: "opencode",
    configDir: "/tmp/home/.config/opencode",
    instructionsPath: "/tmp/home/.config/opencode/AGENTS.md",
    configPath: "/tmp/home/.config/opencode/opencode.jsonc",
    mcpConfigPath: "/tmp/home/.config/opencode/opencode.jsonc",
    skillsDir: "/tmp/home/.config/opencode/skills"
  },
  health: {
    status: "ready",
    installationFound: true,
    installationEvidence: [],
    executableName: "opencode",
    executablePath: "/usr/local/bin/opencode",
    executableFound: true,
    canWrite: true,
    summary: "Ready",
    checks: []
  },
  conversationCapabilities: {
    history: { state: "available", evidence: ["test"] },
    openOriginal: { state: "available", evidence: ["test"] },
    continue: { state: "available", evidence: ["test"] }
  }
};

const resources: ProfileResources = {
  skills: [],
  managementByTarget: {},
  mcpByTarget: {}
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProfileMcpEditor", () => {
  it("labels the live connection area and keeps refresh progress on its initiating control", async () => {
    let finishRefresh: (() => void) | undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));

    render(
      <ProfileMcpEditor
        target={target}
        connections={[]}
        value={resources}
        onChange={() => undefined}
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText("MCP connections")).toBeInTheDocument();
    const refresh = screen.getByRole("button", { name: "Refresh MCP connections" });
    fireEvent.click(refresh);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveAttribute("aria-busy", "true");
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector(".is-spinning")).not.toBeNull();

    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRefresh?.();
    });
    await waitFor(() => expect(refresh).toHaveAttribute("aria-busy", "false"));
    expect(refresh).toBeEnabled();
  });
});
