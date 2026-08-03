import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
  it("sends nothing without explicit consent or a compiled endpoint", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    const fetch = vi.fn();
    const disabled = createTelemetryService({
      statePath: join(root, "state.json"),
      endpoint: "https://telemetry.example.test/v1/events",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: false }) },
      context
    });
    await expect(disabled.recordDailyStartup("ready")).resolves.toEqual({ status: "disabled" });

    const noEndpoint = createTelemetryService({
      statePath: join(root, "other.json"),
      endpoint: "",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context
    });
    await expect(noEndpoint.recordDailyStartup("ready")).resolves.toEqual({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only the allowlisted daily payload and coalesces the same day", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    await mkdir(root, { recursive: true });
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const service = createTelemetryService({
      statePath: join(root, "state.json"),
      endpoint: "https://telemetry.example.test/v1/events",
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context,
      now: () => new Date("2026-08-03T08:00:00Z")
    });

    await expect(service.recordDailyStartup("ready")).resolves.toEqual({ status: "sent" });
    await expect(service.recordDailyStartup("ready")).resolves.toEqual({ status: "already-sent" });

    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(init.body));
    expect(payload).toEqual({
      schemaVersion: 1,
      event: "daily-startup",
      date: "2026-08-03",
      appVersion: "0.2.0",
      platform: "darwin",
      osMajor: "26",
      arch: "arm64",
      locale: "zh_CN",
      installChannel: "homebrew",
      outcome: "ready"
    });
    expect(JSON.stringify(payload)).not.toMatch(/path|profile|skill|prompt|user|url/i);
    expect(JSON.parse(await readFile(join(root, "state.json"), "utf8")))
      .toEqual({ lastSentDate: "2026-08-03" });
  });

  it("returns a stable preview and never rejects startup on network failure", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-telemetry-"));
    const service = createTelemetryService({
      statePath: join(root, "state.json"),
      endpoint: "https://telemetry.example.test/v1/events",
      fetch: vi.fn().mockRejectedValue(new Error("offline")),
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context,
      now: () => new Date("2026-08-03T08:00:00Z")
    });

    expect(service.preview()).toEqual(expect.objectContaining({
      enabledInBuild: true,
      payload: expect.objectContaining({ event: "daily-startup", outcome: "ready" })
    }));
    await expect(service.recordDailyStartup("ready")).resolves.toEqual({ status: "failed" });
  });

  it.each([
    "http://telemetry.example.test",
    "not a URL"
  ])("disables an unsafe endpoint without blocking startup: %s", async (endpoint) => {
    const fetch = vi.fn();
    const service = createTelemetryService({
      statePath: "/tmp/unused",
      endpoint,
      fetch,
      settingsStore: { readSettings: vi.fn().mockResolvedValue({ telemetryEnabled: true }) },
      context
    });

    expect(service.preview().enabledInBuild).toBe(false);
    await expect(service.recordDailyStartup("ready")).resolves.toEqual({ status: "disabled" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
