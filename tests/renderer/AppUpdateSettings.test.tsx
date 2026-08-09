// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppUpdateSettings } from "../../src/renderer/components/AppUpdateSettings";
import type { AgentEnvApi, AgentEnvSettings } from "../../src/shared/types";

afterEach(cleanup);

const settings: AgentEnvSettings = {
  locale: "system",
  conversationTerminal: "default",
  skillSyncMethod: "auto",
  skillStorageLocation: "appData",
  skillAutoCheckEnabled: true,
  skillAutoCheckIntervalMinutes: 60,
  appUpdateAutoCheckEnabled: true,
  appUpdateAutoDownloadEnabled: true,
  appUpdateInstallOnQuit: true,
  telemetryEnabled: false,
  backupRetentionDays: null
};

const installApi = (status: Awaited<ReturnType<AgentEnvApi["readAppUpdateStatus"]>>) => {
  const listeners: Array<(next: typeof status) => void> = [];
  Object.defineProperty(window, "agentEnv", {
    configurable: true,
    value: {
      readAppUpdateStatus: vi.fn().mockResolvedValue(status),
      checkAppUpdate: vi.fn().mockImplementation(async () => {
        listeners.forEach((listener) => listener({ ...status, phase: "checking" }));
        const next = { ...status, phase: "available" as const };
        listeners.forEach((listener) => listener(next));
        return next;
      }),
      downloadAppUpdate: vi.fn(),
      installAppUpdate: vi.fn(),
      onAppUpdateStatusChanged: vi.fn().mockImplementation((listener) => {
        listeners.push(listener);
        return () => undefined;
      })
    } satisfies Partial<AgentEnvApi>
  });
  return window.agentEnv;
};

describe("App update settings", () => {
  it("shows the install channel and keeps manual checks independent from auto-check", async () => {
    const api = installApi({
      phase: "up-to-date",
      currentVersion: "0.1.0",
      installChannel: "homebrew",
      automaticInstallSupported: true,
      checkedAt: "2026-08-03T00:00:00Z"
    });
    const onChange = vi.fn();
    render(<AppUpdateSettings busy={false} settings={settings} onChange={onChange} />);

    const channel = await screen.findByText("Installed with Homebrew");
    const statusRow = channel.closest(".settings-preference-row");
    const autoCheck = screen.getByRole("switch", { name: "Automatic update checks" });
    expect(statusRow).toHaveClass("app-update-summary");
    expect(statusRow?.parentElement).toBe(autoCheck.closest(".settings-preference-list"));
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    await waitFor(() => expect(api.checkAppUpdate).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("switch", { name: "Automatic update checks" }));
    expect(onChange).toHaveBeenCalledWith({ appUpdateAutoCheckEnabled: false });
  });

  it("explains why a direct install cannot update automatically", async () => {
    installApi({
      phase: "available",
      currentVersion: "0.1.0",
      installChannel: "direct",
      automaticInstallSupported: false,
      release: {
        version: "0.2.0",
        tag: "v0.2.0",
        releaseUrl: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
        publishedAt: "2026-08-03T00:00:00Z"
      }
    });
    render(<AppUpdateSettings busy={false} settings={settings} onChange={vi.fn()} />);

    expect(await screen.findByText("Version 0.2.0 is available")).toBeInTheDocument();
    expect(screen.getByText(/application folder cannot be updated automatically/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("offers verified in-app updates for a writable direct installation", async () => {
    installApi({
      phase: "available",
      currentVersion: "0.1.0",
      installChannel: "direct",
      automaticInstallSupported: true,
      release: {
        version: "0.2.0",
        tag: "v0.2.0",
        releaseUrl: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
        publishedAt: "2026-08-03T00:00:00Z"
      }
    });
    render(<AppUpdateSettings busy={false} settings={settings} onChange={vi.fn()} />);

    expect(await screen.findByText("Installed directly")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(screen.getByText("Downloads and verifies the official update in the background."))
      .toBeInTheDocument();
    expect(screen.queryByText("Install when quitting")).not.toBeInTheDocument();
  });

  it("keeps failure detail selectable and retryable", async () => {
    installApi({
      phase: "failed",
      currentVersion: "0.1.0",
      installChannel: "homebrew",
      automaticInstallSupported: true,
      failureCode: "check-failed",
      message: "Update service returned HTTP 503"
    });
    render(<AppUpdateSettings busy={false} settings={settings} onChange={vi.fn()} />);

    expect(await screen.findByText("Update service returned HTTP 503")).toHaveClass(
      "app-update-error"
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("offers the GitHub connection when release checks are rate limited", async () => {
    installApi({
      phase: "failed",
      currentVersion: "0.1.0",
      installChannel: "direct",
      automaticInstallSupported: false,
      failureCode: "rate-limited",
      message: "GitHub temporarily limited update checks. Connect GitHub or try again later."
    });
    const onOpenConnections = vi.fn();
    render(
      <AppUpdateSettings
        busy={false}
        settings={settings}
        onChange={vi.fn()}
        onOpenConnections={onOpenConnections}
      />
    );

    expect(await screen.findByText(/GitHub temporarily limited/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Connections" }).click();
    expect(onOpenConnections).toHaveBeenCalledTimes(1);
  });
});
