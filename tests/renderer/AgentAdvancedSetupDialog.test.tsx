// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TargetInfo } from "../../src/shared/types";
import { AgentAdvancedSetupDialog } from "../../src/renderer/components/AgentAdvancedSetupDialog";

const target: TargetInfo = {
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
  },
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
    executablePath: "/usr/local/bin/codex",
    executableFound: true,
    canWrite: true,
    summary: "Ready",
    checks: []
  },
  conversationCapabilities: {
    history: { state: "available", evidence: [] },
    openOriginal: { state: "available", evidence: [] },
    continue: { state: "available", evidence: [] }
  }
};

afterEach(cleanup);

describe("AgentAdvancedSetupDialog", () => {
  it("keeps folder and command overrides scoped to one Agent", async () => {
    const onSetCommandOverride = vi.fn().mockResolvedValue(undefined);
    render(
      <AgentAdvancedSetupDialog
        open
        busy={false}
        target={target}
        configRoot="/Volumes/AgentConfig/codex"
        commandOverride="codex-preview"
        onClose={vi.fn()}
        onResolveOwnership={vi.fn()}
        onChooseConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onResetConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onSetCommandOverride={onSetCommandOverride}
      />
    );

    expect(screen.getByRole("dialog", { name: "Advanced setup for Codex" })).toBeInTheDocument();
    expect(screen.getByText("/Volumes/AgentConfig/codex")).toBeInTheDocument();
    const command = screen.getByRole("textbox", { name: "Command for Codex" });
    fireEvent.change(command, { target: { value: "codex-nightly" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSetCommandOverride).toHaveBeenCalledWith("codex", "codex-nightly"));
  });

  it("explains retained ownership before allowing a folder change", () => {
    const onResolveOwnership = vi.fn();
    render(
      <AgentAdvancedSetupDialog
        open
        busy={false}
        target={target}
        managementState={{
          targetId: "codex",
          status: "managed",
          lifecycleStatus: "applied",
          managedResourceCount: 2,
          warningCount: 0,
          errorCount: 0
        }}
        onClose={vi.fn()}
        onResolveOwnership={onResolveOwnership}
        onChooseConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onResetConfigRoot={vi.fn().mockResolvedValue(undefined)}
        onSetCommandOverride={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByRole("button", { name: "Choose folder" })).toBeDisabled();
    expect(screen.getByText("Stop AgentEnv management before changing this Agent folder."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop managing" }));
    expect(onResolveOwnership).toHaveBeenCalledWith("codex");
    expect(screen.getByRole("textbox", { name: "Command for Codex" })).toBeEnabled();
  });
});
