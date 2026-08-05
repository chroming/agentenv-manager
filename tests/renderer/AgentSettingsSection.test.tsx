// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TargetDescriptor, TargetInfo } from "../../src/shared/types";
import { AgentSettingsSection } from "../../src/renderer/components/AgentSettingsSection";

const descriptor: TargetDescriptor = {
  id: "codex",
  name: "Codex",
  description: "Manage Codex.",
  iconKey: "codex",
  instructionsLabel: "AGENTS.md",
  configLabel: "config.toml",
  configLanguage: "toml",
  realWritesEnabled: true,
  executableName: "codex",
  executableCandidates: ["codex"],
  capabilities: {
    instructions: true,
    skills: true,
    mcpTransports: ["stdio"],
    agentFormat: "codex",
    disabledSkillPaths: false,
    mcpActivation: true
  }
};

const agent: TargetInfo = {
  ...descriptor,
  paths: {
    targetId: "codex",
    configDir: "/Users/example/.codex",
    instructionsPath: "/Users/example/.codex/AGENTS.md",
    configPath: "/Users/example/.codex/config.toml",
    skillsDir: "/Users/example/.codex/skills"
  },
  health: {
    status: "ready",
    installationFound: true,
    installationEvidence: [],
    executableName: "codex",
    executableCandidates: ["codex"],
    executableStatus: "found",
    executableCandidate: "codex",
    executablePath: "/usr/local/bin/codex",
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

afterEach(cleanup);

describe("AgentSettingsSection", () => {
  it("uses the shared dialog button hierarchy when turning off a managed Agent", () => {
    render(
      <AgentSettingsSection
        supportedAgents={[descriptor]}
        enabledAgentIds={["codex"]}
        agents={[agent]}
        agentStates={[{
          targetId: "codex",
          status: "managed",
          lifecycleStatus: "applied",
          managedResourceCount: 1,
          warningCount: 0,
          errorCount: 0
        }]}
        suppressedAgentIds={[]}
        busy={false}
        onSetEnabled={vi.fn().mockResolvedValue(undefined)}
        onRestoreAgentSuggestions={vi.fn().mockResolvedValue(undefined)}
        onOpenRecovery={vi.fn()}
        configRoots={{}}
        commandOverrides={{}}
        onChooseConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onResetConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onSetCommandOverride={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Turn off Codex" }));
    const dialog = screen.getByRole("dialog", { name: "Turn off Codex?" });
    expect(dialog.querySelectorAll(".ui-button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("ui-button--secondary");
    expect(screen.getByRole("button", { name: "Turn off Codex" })).toHaveClass("ui-button--primary");
  });

  it("uses stable custom-folder actions and reports progress on the affected row", async () => {
    let finishChoose: (() => void) | undefined;
    const onChooseConfigRoot = vi.fn(() => new Promise<void>((resolve) => {
      finishChoose = resolve;
    }));
    const onResetConfigRoot = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentSettingsSection
        supportedAgents={[descriptor]}
        enabledAgentIds={["codex"]}
        agents={[agent]}
        agentStates={[]}
        suppressedAgentIds={[]}
        busy={false}
        onSetEnabled={vi.fn().mockResolvedValue(undefined)}
        onRestoreAgentSuggestions={vi.fn().mockResolvedValue(undefined)}
        onOpenRecovery={vi.fn()}
        configRoots={{ codex: "/Volumes/Workspace/config/codex" }}
        commandOverrides={{}}
        onChooseConfigRoot={onChooseConfigRoot}
        onResetConfigRoot={onResetConfigRoot}
        onSetCommandOverride={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByText("Custom folders"));
    expect(screen.getByText("Custom · config/codex")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use default" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("button", { name: "Choosing..." })).toBeDisabled();
    finishChoose?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Change" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Use default" }));
    await waitFor(() => expect(onResetConfigRoot).toHaveBeenCalledWith("codex"));
  });

  it("saves and resets a Target-specific command override", async () => {
    const onSetCommandOverride = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentSettingsSection
        supportedAgents={[descriptor]}
        enabledAgentIds={["codex"]}
        agents={[agent]}
        agentStates={[]}
        suppressedAgentIds={[]}
        busy={false}
        onSetEnabled={vi.fn().mockResolvedValue(undefined)}
        onRestoreAgentSuggestions={vi.fn().mockResolvedValue(undefined)}
        onOpenRecovery={vi.fn()}
        configRoots={{}}
        commandOverrides={{ codex: "/opt/tools/codex-wrapper" }}
        onChooseConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onResetConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onSetCommandOverride={onSetCommandOverride}
      />
    );

    fireEvent.click(screen.getByText("Custom commands"));
    const input = screen.getByRole("textbox", { name: "Command for Codex" });
    expect(input).toHaveValue("/opt/tools/codex-wrapper");

    fireEvent.change(input, { target: { value: "codex-nightly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Codex command" }));
    await waitFor(() => expect(onSetCommandOverride).toHaveBeenCalledWith("codex", "codex-nightly"));

    fireEvent.click(screen.getByRole("button", { name: "Use default Codex command" }));
    await waitFor(() => expect(onSetCommandOverride).toHaveBeenCalledWith("codex", undefined));
  });
});
