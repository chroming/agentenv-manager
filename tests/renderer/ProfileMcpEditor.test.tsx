// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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
  executableCandidates: ["opencode"],
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
    executableCandidates: ["opencode"],
    executableStatus: "found",
    executableCandidate: "opencode",
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

    expect(screen.getByText("Configured in OpenCode")).toBeInTheDocument();
    expect(screen.getByText("No MCP connections are configured in OpenCode.")).toBeInTheDocument();
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

  it("uses one On/Off switch for each manageable connection", () => {
    const onChange = vi.fn();
    render(
      <ProfileMcpEditor
        target={target}
        connections={[{
          targetId: "opencode",
          name: "docs",
          scope: "user",
          transport: "stdio",
          enabled: true,
          controllable: true,
          sourcePath: "/tmp/home/.config/opencode/opencode.jsonc"
        }]}
        value={{
          ...resources,
          mcpByTarget: {
            opencode: { mode: "manage", selections: [] }
          }
        }}
        onChange={onChange}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByRole("radiogroup", { name: "docs Profile behavior" })).toBeNull();
    const toggle = screen.getByRole("switch", { name: "Turn off docs" });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({
      ...resources,
      mcpByTarget: {
        opencode: { mode: "manage", selections: [{ name: "docs", enabled: false }] }
      }
    });
  });

  it("renders Off as a read-only effective state", () => {
    const onChange = vi.fn();
    render(
      <ProfileMcpEditor
        target={target}
        connections={[{
          targetId: "opencode",
          name: "docs",
          scope: "user",
          transport: "stdio",
          enabled: true,
          controllable: true,
          sourcePath: "/tmp/home/.config/opencode/opencode.jsonc"
        }]}
        value={{
          ...resources,
          mcpByTarget: {
            opencode: { mode: "disable", selections: [{ name: "docs", enabled: true }] }
          }
        }}
        onChange={onChange}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const toggle = screen.getByRole("switch", { name: "Turn on docs" });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses a static state label when the Agent controls MCP activation", () => {
    const onChange = vi.fn();
    render(
      <ProfileMcpEditor
        target={{
          ...target,
          capabilities: { ...target.capabilities, mcpActivation: false }
        }}
        connections={[{
          targetId: "opencode",
          name: "docs",
          scope: "user",
          transport: "stdio",
          enabled: true,
          controllable: false,
          sourcePath: "/tmp/home/.config/opencode/opencode.jsonc"
        }]}
        value={resources}
        onChange={onChange}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const state = screen.getByText("Agent controlled");
    expect(state.tagName).toBe("SPAN");
    expect(state).toHaveClass("profile-mcp-agent-state");
    expect(screen.queryByRole("button", { name: "Agent controlled" })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
