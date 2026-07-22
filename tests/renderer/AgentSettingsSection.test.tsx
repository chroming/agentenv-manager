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
    executablePath: "/usr/local/bin/codex",
    executableFound: true,
    canWrite: true,
    summary: "Ready",
    checks: []
  }
};

afterEach(cleanup);

describe("AgentSettingsSection", () => {
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
        busy={false}
        onSetEnabled={vi.fn().mockResolvedValue(undefined)}
        onOpenRecovery={vi.fn()}
        configRoots={{ codex: "/Volumes/Workspace/config/codex" }}
        onChooseConfigRoot={onChooseConfigRoot}
        onResetConfigRoot={onResetConfigRoot}
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
});
