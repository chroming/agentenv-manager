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
  telemetryEnabled: false,
  backupRetentionDays: null
};

describe("Telemetry settings", () => {
  it("requires explicit consent and previews the exact allowlisted fields", async () => {
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: {
        readTelemetryPreview: vi.fn().mockResolvedValue({
          enabledInBuild: true,
          payload: {
            schemaVersion: 1,
            event: "daily-startup",
            date: "2026-08-03",
            appVersion: "0.2.0",
            platform: "darwin",
            osMajor: "26",
            arch: "arm64",
            locale: "en",
            installChannel: "homebrew",
            outcome: "ready"
          }
        })
      }
    });
    const onChange = vi.fn();
    render(<TelemetrySettings busy={false} settings={settings} onChange={onChange} />);

    expect(screen.getByRole("switch", { name: "Share anonymous reliability data" }))
      .toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous reliability data" }));
    expect(onChange).toHaveBeenCalledWith({ telemetryEnabled: true });

    fireEvent.click(await screen.findByText("Preview shared data"));
    expect(await screen.findByText(/"appVersion": "0.2.0"/)).toBeInTheDocument();
    expect(screen.queryByText(/profile|skill|path|prompt/i)).not.toBeInTheDocument();
  });

  it("explains when this build has no reporting endpoint", async () => {
    Object.defineProperty(window, "agentEnv", {
      configurable: true,
      value: {
        readTelemetryPreview: vi.fn().mockResolvedValue({
          enabledInBuild: false,
          payload: {
            schemaVersion: 1,
            event: "daily-startup",
            date: "2026-08-03",
            appVersion: "0.2.0",
            platform: "darwin",
            osMajor: "26",
            arch: "arm64",
            locale: "en",
            installChannel: "development",
            outcome: "ready"
          }
        })
      }
    });
    render(<TelemetrySettings busy={false} settings={settings} onChange={vi.fn()} />);
    expect(await screen.findByText("This build does not send reliability data."))
      .toBeInTheDocument();
  });
});
