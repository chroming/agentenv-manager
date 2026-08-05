// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetrySettings } from "../../src/renderer/components/TelemetrySettings";
import type { AgentEnvSettings } from "../../src/shared/types";

afterEach(cleanup);

const settings: AgentEnvSettings = {
  locale: "system",
  conversationTerminal: "default",
  skillSyncMethod: "auto",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  telemetryEnabled: true,
  backupRetentionDays: null
};

describe("Telemetry settings", () => {
  it("starts enabled, explains the allowlist, supports opt-out, and previews shared fields", async () => {
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: {
        readTelemetryPreview: vi.fn().mockResolvedValue({
          enabledInBuild: true,
          destination: "PostHog Cloud",
          installationId: "6b7ef3c8-b8a4-49a6-b947-cae90b935a25",
          payload: {
            schemaVersion: 2,
            event: "agentenv_daily_startup",
            date: "2026-08-03",
            appVersion: "0.2.0",
            platform: "darwin",
            osMajor: "26",
            arch: "arm64",
            locale: "en",
            installChannel: "homebrew"
          }
        })
      }
    });
    const onChange = vi.fn();
    const { container } = render(
      <TelemetrySettings busy={false} settings={settings} onChange={onChange} />
    );

    expect(screen.getByRole("switch", { name: "Share anonymous usage statistics" }))
      .toHaveAttribute("aria-checked", "true");
    fireEvent.focus(screen.getByLabelText(/Once per local day, AgentEnv sends/));
    expect(screen.getByRole("tooltip")).toHaveTextContent("to PostHog Cloud");
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "It never includes actions, results, paths, names, repositories, conversations, prompts, or file contents."
    );
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous usage statistics" }));
    expect(onChange).toHaveBeenCalledWith({ telemetryEnabled: false });

    fireEvent.click(await screen.findByText("Preview shared data"));
    expect(await screen.findByText(/"appVersion": "0.2.0"/)).toBeInTheDocument();
    expect(screen.getByText(/"installationId": "6b7ef3c8/)).toBeInTheDocument();
    expect(container.querySelector(".telemetry-preview pre")?.textContent)
      .not.toMatch(/profile|skill|path|prompt/i);
  });

  it("explains when this build has no reporting endpoint", async () => {
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: {
        readTelemetryPreview: vi.fn().mockResolvedValue({
          enabledInBuild: false,
          destination: "PostHog Cloud",
          installationId: "31e27e20-a4ed-4a4a-96b1-c4213d2864eb",
          payload: {
            schemaVersion: 2,
            event: "agentenv_daily_startup",
            date: "2026-08-03",
            appVersion: "0.2.0",
            platform: "darwin",
            osMajor: "26",
            arch: "arm64",
            locale: "en",
            installChannel: "development"
          }
        })
      }
    });
    render(<TelemetrySettings busy={false} settings={settings} onChange={vi.fn()} />);
    expect(await screen.findByText("This build does not send anonymous usage statistics. Your preference is kept for future builds."))
      .toBeInTheDocument();
    const telemetrySwitch = screen.getByRole("switch", {
      name: "Share anonymous usage statistics"
    });
    expect(telemetrySwitch).toBeEnabled();
    fireEvent.click(telemetrySwitch);
  });
});
