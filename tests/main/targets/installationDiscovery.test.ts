import { describe, expect, it, vi } from "vitest";
import {
  createAntigravityInstallationDriver,
  createInstallationDriver
} from "../../../src/main/targets/installationDiscovery";
import { createBuiltInTargetAdapters } from "../../../src/main/targets/integrations";

const detect = (
  platform: NodeJS.Platform,
  options: { executablePath?: string; existingPaths?: string[]; systemApps?: boolean } = {}
) => createAntigravityInstallationDriver().detectInstallation({
  platform,
  homeDir: "/Users/test",
  allowSystemApplicationLookup: options.systemApps ?? false,
  findExecutable: vi.fn().mockResolvedValue(options.executablePath),
  pathExists: vi.fn(async (path: string) => options.existingPaths?.includes(path) ?? false)
});

describe("Antigravity installation discovery", () => {
  it.each<NodeJS.Platform>(["darwin", "linux", "win32"])(
    "detects the agy command on %s",
    async (platform) => {
      const result = await detect(platform, { executablePath: "/tooling/agy" });

      expect(result).toEqual({
        found: true,
        evidence: [{ kind: "command", label: "agy command", path: "/tooling/agy" }]
      });
    }
  );

  it("does not confuse the macOS application with Antigravity CLI", async () => {
    const path = "/Users/test/Applications/Antigravity.app";
    const result = await detect("darwin", { existingPaths: [path] });

    expect(result).toEqual({ found: false, evidence: [] });
  });

  it("detects the documented Windows user installation when PATH is stale", async () => {
    const path = "/Users/test/AppData/Local/agy/bin/agy.exe";
    const result = await detect("win32", { existingPaths: [path] });

    expect(result).toEqual({
      found: true,
      evidence: [{ kind: "command", label: "agy command", path }]
    });
  });

  it("does not use the system application as CLI installation evidence", async () => {
    const path = "/Applications/Antigravity.app";
    await expect(detect("darwin", { existingPaths: [path] })).resolves.toEqual({
      found: false,
      evidence: []
    });
    await expect(
      detect("darwin", { existingPaths: [path], systemApps: true })
    ).resolves.toEqual({ found: false, evidence: [] });
  });

  it("does not treat configuration residue as an installation", async () => {
    await expect(detect("linux")).resolves.toEqual({ found: false, evidence: [] });
  });
});

describe("desktop-capable installation discovery", () => {
  const driver = createInstallationDriver({
    commands: ["example"],
    macApplications: [{ bundleName: "Example.app", label: "Example app" }]
  });

  it("collects command and user application evidence without system lookup", async () => {
    const input = {
      platform: "darwin" as const,
      homeDir: "/Users/test",
      allowSystemApplicationLookup: false,
      findExecutable: vi.fn().mockResolvedValue("/tooling/example"),
      pathExists: vi.fn(async (path: string) => path === "/Users/test/Applications/Example.app")
    };

    await expect(driver.detectInstallation(input)).resolves.toEqual({
      found: true,
      evidence: [
        { kind: "command", label: "example command", path: "/tooling/example" },
        {
          kind: "desktop-app",
          label: "Example app",
          path: "/Users/test/Applications/Example.app"
        }
      ]
    });
  });

  it("uses /Applications only when real system application lookup is enabled", async () => {
    const detectSystemApplication = (allowSystemApplicationLookup: boolean) =>
      driver.detectInstallation({
        platform: "darwin",
        homeDir: "/Users/test",
        allowSystemApplicationLookup,
        findExecutable: vi.fn().mockResolvedValue(undefined),
        pathExists: vi.fn(async (path: string) => path === "/Applications/Example.app")
      });

    await expect(detectSystemApplication(false)).resolves.toEqual({ found: false, evidence: [] });
    await expect(detectSystemApplication(true)).resolves.toEqual({
      found: true,
      evidence: [{ kind: "desktop-app", label: "Example app", path: "/Applications/Example.app" }]
    });
  });

  it("ignores macOS applications on other platforms", async () => {
    await expect(driver.detectInstallation({
      platform: "linux",
      homeDir: "/home/test",
      allowSystemApplicationLookup: true,
      findExecutable: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn().mockResolvedValue(true)
    })).resolves.toEqual({ found: false, evidence: [] });
  });

  it("preserves each built-in adapter's own installation driver", async () => {
    const codex = createBuiltInTargetAdapters().find((adapter) => adapter.descriptor.id === "codex");

    await expect(codex?.detectInstallation({
      platform: "darwin",
      homeDir: "/Users/test",
      allowSystemApplicationLookup: false,
      findExecutable: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn(async (path: string) => path === "/Users/test/Applications/Codex.app")
    })).resolves.toEqual({
      found: true,
      evidence: [{
        kind: "desktop-app",
        label: "Codex app",
        path: "/Users/test/Applications/Codex.app"
      }]
    });
  });
});
