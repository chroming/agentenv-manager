import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelemetryService } from "../../src/main/telemetry/telemetryService";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const context = {
  appVersion: "0.2.0",
  platform: "darwin" as const,
  osVersion: "26.1.0",
  arch: "arm64",
  locale: "zh_CN" as const,
  installChannel: "homebrew" as const
};

describe("telemetry service", () => {
  it("sends nothing after opt-out or without a compiled PostHog token", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    const fetch = vi.fn();
    const disabled = createTelemetryService({
      statePath: join(root, "state.json"),
      host: "https://us.i.posthog.com",
      projectToken: "phc_test",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: false }) },
      context
    });
    await expect(disabled.recordDailyStartup()).resolves.toEqual({ status: "disabled" });

    const noEndpoint = createTelemetryService({
      statePath: join(root, "other.json"),
      host: "https://us.i.posthog.com",
      projectToken: "",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context
    });
    await expect(noEndpoint.recordDailyStartup()).resolves.toEqual({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only the allowlisted daily payload and coalesces the same day", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    await mkdir(root, { recursive: true });
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const service = createTelemetryService({
      statePath: join(root, "state.json"),
      host: "https://us.i.posthog.com",
      projectToken: "phc_test",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context,
      now: () => new Date(2026, 7, 3, 23, 30),
      createInstallationId: () => "6b7ef3c8-b8a4-49a6-b947-cae90b935a25"
    });

    await expect(service.recordDailyStartup()).resolves.toEqual({ status: "sent" });
    await expect(service.recordDailyStartup()).resolves.toEqual({ status: "already-sent" });

    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const request = JSON.parse(String(init.body));
    expect(fetch).toHaveBeenCalledWith("https://us.i.posthog.com/i/v0/e/", expect.any(Object));
    expect(request).toEqual({
      api_key: "phc_test",
      distinct_id: "6b7ef3c8-b8a4-49a6-b947-cae90b935a25",
      event: "agentenv_daily_startup",
      properties: {
        $geoip_disable: true,
        $process_person_profile: false,
        appVersion: "0.2.0",
        arch: "arm64",
        date: "2026-08-03",
        installChannel: "homebrew",
        locale: "zh_CN",
        osMajor: "26",
        platform: "darwin",
        schemaVersion: 2
      }
    });
    expect(Object.keys(request.properties).filter((key) => !key.startsWith("$")).sort()).toEqual([
      "appVersion",
      "arch",
      "date",
      "installChannel",
      "locale",
      "osMajor",
      "platform",
      "schemaVersion"
    ]);
    expect(JSON.parse(await readFile(join(root, "state.json"), "utf8")))
      .toEqual({
        installationId: "6b7ef3c8-b8a4-49a6-b947-cae90b935a25",
        lastSentDate: "2026-08-03"
      });
  });

  it("adds an installation id to a legacy receipt without resending the same local day", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    const statePath = join(root, "state.json");
    await writeFile(statePath, `${JSON.stringify({ lastSentDate: "2026-08-03" })}\n`);
    const fetch = vi.fn();
    const service = createTelemetryService({
      statePath,
      host: "https://us.i.posthog.com",
      projectToken: "phc_test",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context,
      now: () => new Date(2026, 7, 3, 23, 45),
      createInstallationId: () => "31e27e20-a4ed-4a4a-96b1-c4213d2864eb"
    });

    await expect(service.recordDailyStartup()).resolves.toEqual({ status: "already-sent" });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      installationId: "31e27e20-a4ed-4a4a-96b1-c4213d2864eb",
      lastSentDate: "2026-08-03"
    });
  });

  it("returns a stable preview and never rejects startup on network failure", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    const service = createTelemetryService({
      statePath: join(root, "state.json"),
      host: "https://eu.i.posthog.com",
      projectToken: "phc_test",
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context,
      now: () => new Date(2026, 7, 3, 8, 0),
      createInstallationId: () => "2e5852b7-1ee3-48c8-a7ad-f9606dbcae1e"
    });

    await expect(service.preview()).resolves.toEqual(expect.objectContaining({
      enabledInBuild: true,
      destination: "PostHog Cloud",
      installationId: "2e5852b7-1ee3-48c8-a7ad-f9606dbcae1e",
      payload: expect.not.objectContaining({ outcome: expect.anything() })
    }));
    await expect(service.recordDailyStartup()).resolves.toEqual({ status: "failed" });
  });

  it.each([
    "http://us.i.posthog.com",
    "https://telemetry.example.test",
    "not a URL"
  ])("disables an unsupported PostHog host without blocking startup: %s", async (host) => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    const fetch = vi.fn();
    const service = createTelemetryService({
      statePath: join(root, "state.json"),
      host,
      projectToken: "phc_test",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context
    });

    expect((await service.preview()).enabledInBuild).toBe(false);
    await expect(service.recordDailyStartup()).resolves.toEqual({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
