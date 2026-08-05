// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentDiscoveryDialog } from "../../src/renderer/components/AgentDiscoveryDialog";
import type { TargetInfo } from "../../src/shared/types";

const agent = (id: string, name: string, installed: boolean): TargetInfo => ({
  id,
  name,
  description: name,
  iconKey: id === "opencode" ? "opencode" : "codex",
  displayOrder: 1,
  instructionsLabel: "AGENTS.md",
  configLabel: "config",
  configLanguage: "text",
  realWritesEnabled: true,
  executableName: id,
  executableCandidates: [id],
  capabilities: {
    instructions: true,
    skills: true,
    mcpTransports: [],
    disabledSkillPaths: false
  },
  paths: {
    targetId: id,
    configDir: `/tmp/${id}`,
    instructionsPath: `/tmp/${id}/AGENTS.md`,
    configPath: `/tmp/${id}/config`
  },
  health: {
    status: installed ? "ready" : "missing",
    installationFound: installed,
    installationEvidence: installed
      ? [{ kind: "command", label: name, path: `/usr/local/bin/${id}` }]
      : [],
    executableName: id,
    executableCandidates: [id],
    executableStatus: installed ? "found" : "missing",
    executableCandidate: installed ? id : undefined,
    executablePath: installed ? `/usr/local/bin/${id}` : undefined,
    executableFound: installed,
    canWrite: installed,
    summary: installed ? "Ready" : "Not detected",
    checks: []
  },
  conversationCapabilities: {
    history: { state: "unavailable", evidence: [] },
    openOriginal: { state: "unavailable", evidence: [] },
    continue: { state: "unavailable", evidence: [] }
  }
});

afterEach(cleanup);

describe("AgentDiscoveryDialog", () => {
  it("selects detected Agents and leaves undetected Agents off by default", () => {
    render(
      <AgentDiscoveryDialog
        agents={[
          agent("opencode", "OpenCode", true),
          agent("codex", "Codex", false)
        ]}
        allowSuggestionPreferences={false}
        busy={false}
        open
        phase="choose"
        setupActions={{}}
        onConfigure={vi.fn()}
        onDismiss={vi.fn()}
        onEnable={vi.fn().mockResolvedValue(undefined)}
        onSuppress={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const dialog = screen.getByRole("dialog", { name: "Choose Agents" });
    expect(within(dialog).getByRole("checkbox", { name: "OpenCode" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "Codex" })).not.toBeChecked();
    expect(within(dialog).getByText("Not detected")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Enable 1 Agent" }))
      .toBeEnabled();
  });
});
