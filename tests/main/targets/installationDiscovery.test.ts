import { describe, expect, it, vi } from "vitest";
import { createAntigravityInstallationDriver } from "../../../src/main/targets/installationDiscovery";

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

  it("detects a user-installed macOS application without the CLI", async () => {
    const path = "/Users/test/Applications/Antigravity.app";
    const result = await detect("darwin", { existingPaths: [path] });

    expect(result).toEqual({
      found: true,
      evidence: [{ kind: "desktop-app", label: "Antigravity application", path }]
    });
  });

  it("detects the documented Windows user installation when PATH is stale", async () => {
    const path = "/Users/test/AppData/Local/agy/bin/agy.exe";
    const result = await detect("win32", { existingPaths: [path] });

    expect(result).toEqual({
      found: true,
      evidence: [{ kind: "command", label: "agy command", path }]
    });
  });

  it("checks the system Applications directory only when allowed", async () => {
    const path = "/Applications/Antigravity.app";
    await expect(detect("darwin", { existingPaths: [path] })).resolves.toEqual({
      found: false,
      evidence: []
    });
    await expect(
      detect("darwin", { existingPaths: [path], systemApps: true })
    ).resolves.toEqual({
      found: true,
      evidence: [{ kind: "desktop-app", label: "Antigravity application", path }]
    });
  });

  it("does not treat configuration residue as an installation", async () => {
    await expect(detect("linux")).resolves.toEqual({ found: false, evidence: [] });
  });
});
