import { describe, expect, it, vi } from "vitest";
import { createAppUpdateService } from "../../../src/main/appUpdates/updateService";
import { ReleaseClientError } from "../../../src/main/appUpdates/releaseClient";

const release = {
  version: "0.2.0",
  tag: "v0.2.0",
  releaseUrl: "https://github.com/chroming/agentenv-manager/releases/tag/v0.2.0",
  publishedAt: "2026-08-03T00:00:00Z",
  notes: "Ready",
  asset: {
    name: "AgentEnv-Manager-0.2.0-mac-arm64.zip",
    url: "https://github.com/chroming/agentenv-manager/releases/download/v0.2.0/AgentEnv-Manager-0.2.0-mac-arm64.zip",
    sha256: "a".repeat(64),
    size: 123
  }
};

const settings = {
  appUpdateAutoCheckEnabled: true,
  appUpdateAutoDownloadEnabled: false,
  appUpdateInstallOnQuit: true
};

const unavailableDirect = () => ({
  inspect: vi.fn().mockResolvedValue({ available: false, reason: "unsupported-platform" as const }),
  download: vi.fn(),
  install: vi.fn()
});

const unavailableHomebrew = () => ({
  inspect: vi.fn().mockResolvedValue({ available: false, managed: false }),
  download: vi.fn(),
  install: vi.fn(),
  scheduleInstallAfterQuit: vi.fn()
});

describe("app update service", () => {
  it("coalesces checks and reports a verified update without exposing arbitrary URLs", async () => {
    let resolveRelease!: (value: typeof release) => void;
    const readLatest = vi.fn(() => new Promise<typeof release>((resolve) => {
      resolveRelease = resolve;
    }));
    const inspect = vi.fn().mockResolvedValue({
      available: true,
      managed: true,
      executablePath: "/opt/homebrew/bin/brew"
    });
    const changes: string[] = [];
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: { readLatest, isNewer: () => true },
      homebrew: {
        inspect,
        download: vi.fn(),
        install: vi.fn(),
        scheduleInstallAfterQuit: vi.fn()
      },
      direct: unavailableDirect(),
      settingsStore: { readSettings: vi.fn().mockResolvedValue(settings) },
      onStatusChanged: (status) => changes.push(status.phase)
    });

    const first = service.check({ manual: true });
    const second = service.check({ manual: true });
    await vi.waitFor(() => expect(readLatest).toHaveBeenCalledTimes(1));
    resolveRelease(release);

    await expect(first).resolves.toMatchObject({ phase: "available", release: { version: "0.2.0" } });
    await expect(second).resolves.toMatchObject({ phase: "available" });
    expect(readLatest).toHaveBeenCalledTimes(1);
    expect(inspect).toHaveBeenCalledWith({ refresh: true });
    expect(changes).toContain("checking");
  });

  it("keeps manual checks available when automatic checks are disabled", async () => {
    const readLatest = vi.fn().mockResolvedValue(release);
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: { readLatest, isNewer: () => true },
      homebrew: unavailableHomebrew(),
      direct: unavailableDirect(),
      settingsStore: {
        readSettings: vi.fn().mockResolvedValue({ ...settings, appUpdateAutoCheckEnabled: false })
      }
    });

    await expect(service.check()).resolves.toMatchObject({ phase: "disabled" });
    await expect(service.check({ manual: true })).resolves.toMatchObject({
      phase: "available",
      installChannel: "direct",
      automaticInstallSupported: false
    });
  });

  it("prefetches through Homebrew and installs only a ready update", async () => {
    const onInstalled = vi.fn();
    const homebrew = {
      inspect: vi.fn().mockResolvedValue({ available: true, managed: true, executablePath: "/opt/homebrew/bin/brew" }),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      scheduleInstallAfterQuit: vi.fn().mockResolvedValue(undefined)
    };
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: { readLatest: vi.fn().mockResolvedValue(release), isNewer: () => true },
      homebrew,
      direct: unavailableDirect(),
      settingsStore: {
        readSettings: vi.fn().mockResolvedValue({ ...settings, appUpdateAutoDownloadEnabled: true })
      },
      onInstalled
    });

    await expect(service.check()).resolves.toMatchObject({ phase: "ready" });
    await expect(service.install({ restart: true })).resolves.toMatchObject({ phase: "up-to-date" });
    expect(homebrew.download).toHaveBeenCalledTimes(1);
    expect(homebrew.install).toHaveBeenCalledTimes(1);
    expect(onInstalled).toHaveBeenCalledWith(true, "homebrew");
  });

  it("downloads and stages a verified direct Release update", async () => {
    const onInstalled = vi.fn();
    const direct = {
      inspect: vi.fn().mockResolvedValue({ available: true }),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined)
    };
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: { readLatest: vi.fn().mockResolvedValue(release), isNewer: () => true },
      homebrew: unavailableHomebrew(),
      direct,
      settingsStore: {
        readSettings: vi.fn().mockResolvedValue({ ...settings, appUpdateAutoDownloadEnabled: true })
      },
      onInstalled
    });

    await expect(service.check()).resolves.toMatchObject({
      phase: "ready",
      installChannel: "direct",
      automaticInstallSupported: true
    });
    expect(direct.download).toHaveBeenCalledWith(release);
    await expect(service.install({ restart: true })).resolves.toMatchObject({
      phase: "up-to-date",
      installChannel: "direct"
    });
    expect(direct.install).toHaveBeenCalledWith("0.2.0");
    expect(onInstalled).toHaveBeenCalledWith(true, "direct");
    expect(service.canScheduleInstallOnQuit()).toBe(false);
  });

  it("turns offline failures into non-blocking copyable state", async () => {
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: {
        readLatest: vi.fn().mockRejectedValue(new Error("network unavailable")),
        isNewer: () => true
      },
      homebrew: unavailableHomebrew(),
      direct: unavailableDirect(),
      settingsStore: { readSettings: vi.fn().mockResolvedValue(settings) }
    });

    await expect(service.check({ manual: true })).resolves.toMatchObject({
      phase: "failed",
      failureCode: "check-failed",
      message: "network unavailable"
    });
  });

  it("preserves actionable release failure codes for the renderer", async () => {
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: {
        readLatest: vi.fn().mockRejectedValue(new ReleaseClientError(
          "rate-limited",
          "GitHub temporarily limited update checks. Connect GitHub or try again later."
        )),
        isNewer: () => true
      },
      homebrew: unavailableHomebrew(),
      direct: unavailableDirect(),
      settingsStore: { readSettings: vi.fn().mockResolvedValue(settings) }
    });

    await expect(service.check({ manual: true })).resolves.toMatchObject({
      phase: "failed",
      failureCode: "rate-limited"
    });
  });

  it("schedules a prepared Homebrew update without running the installer in the App process", async () => {
    const homebrew = {
      inspect: vi.fn().mockResolvedValue({
        available: true,
        managed: true,
        executablePath: "/opt/homebrew/bin/brew"
      }),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      scheduleInstallAfterQuit: vi.fn().mockResolvedValue(undefined)
    };
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: { readLatest: vi.fn().mockResolvedValue(release), isNewer: () => true },
      homebrew,
      direct: unavailableDirect(),
      settingsStore: {
        readSettings: vi.fn().mockResolvedValue({ ...settings, appUpdateAutoDownloadEnabled: true })
      }
    });

    await expect(service.check()).resolves.toMatchObject({ phase: "ready" });
    expect(service.canScheduleInstallOnQuit()).toBe(true);
    await expect(service.scheduleInstallOnQuit()).resolves.toBe(true);
    expect(homebrew.scheduleInstallAfterQuit).toHaveBeenCalledWith("0.2.0");
    expect(homebrew.install).not.toHaveBeenCalled();
    await expect(service.readStatus()).resolves.toMatchObject({ phase: "installing" });
  });

  it("surfaces a preserved automatic-install failure without replacing it during startup", async () => {
    const service = createAppUpdateService({
      currentVersion: "0.1.0",
      packaged: true,
      platform: "darwin",
      arch: "arm64",
      releaseClient: { readLatest: vi.fn(), isNewer: () => true },
      homebrew: unavailableHomebrew(),
      direct: unavailableDirect(),
      settingsStore: { readSettings: vi.fn().mockResolvedValue(settings) },
      startupFailure: "Homebrew retained the previous version"
    });

    await expect(service.readStatus()).resolves.toMatchObject({
      phase: "failed",
      installChannel: "homebrew",
      failureCode: "install-failed",
      message: "Homebrew retained the previous version"
    });
  });
});
