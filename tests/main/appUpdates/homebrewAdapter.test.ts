import { describe, expect, it, vi } from "vitest";
import { createHomebrewAdapter } from "../../../src/main/appUpdates/homebrewAdapter";

describe("Homebrew update adapter", () => {
  it("discovers Homebrew outside a packaged app PATH and uses argument arrays", async () => {
    const run = vi.fn(async (_file: string, args: string[]) => ({
      exitCode: args[0] === "list" ? 0 : 0,
      stdout: args[0] === "list" ? "agentenv-manager 0.1.0\n" : "",
      stderr: ""
    }));
    const adapter = createHomebrewAdapter({
      platform: "darwin",
      canExecute: async (path) => path === "/opt/homebrew/bin/brew",
      run
    });

    await expect(adapter.inspect()).resolves.toMatchObject({
      available: true,
      managed: true,
      executablePath: "/opt/homebrew/bin/brew"
    });
    await adapter.download();
    await adapter.install("0.1.0");

    expect(run).toHaveBeenNthCalledWith(
      2,
      "/opt/homebrew/bin/brew",
      ["fetch", "--cask", "chroming/tap/agentenv-manager"],
      expect.any(Object)
    );
    expect(run).toHaveBeenNthCalledWith(
      3,
      "/opt/homebrew/bin/brew",
      ["upgrade", "--cask", "chroming/tap/agentenv-manager"],
      expect.any(Object)
    );
    expect(run).toHaveBeenLastCalledWith(
      "/opt/homebrew/bin/brew",
      ["list", "--cask", "--versions", "agentenv-manager"],
      expect.any(Object)
    );
  });

  it("does not offer installation when the app is not Homebrew managed", async () => {
    const adapter = createHomebrewAdapter({
      platform: "darwin",
      canExecute: async () => true,
      run: vi.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "not installed" })
    });
    await expect(adapter.inspect()).resolves.toMatchObject({ available: true, managed: false });
    await expect(adapter.download()).rejects.toThrow("not managed by Homebrew");
  });

  it("can refresh a previously cached direct-install result", async () => {
    let managed = false;
    const adapter = createHomebrewAdapter({
      platform: "darwin",
      canExecute: async () => true,
      run: vi.fn(async () => ({
        exitCode: managed ? 0 : 1,
        stdout: managed ? "agentenv-manager 0.2.0\n" : "",
        stderr: ""
      }))
    });

    await expect(adapter.inspect()).resolves.toMatchObject({ managed: false });
    managed = true;
    await expect(adapter.inspect()).resolves.toMatchObject({ managed: false });
    await expect(adapter.inspect({ refresh: true })).resolves.toMatchObject({
      managed: true,
      installedVersion: "0.2.0"
    });
  });

  it("is unavailable on non-macOS platforms", async () => {
    const adapter = createHomebrewAdapter({ platform: "linux" });
    await expect(adapter.inspect()).resolves.toEqual({ available: false, managed: false });
  });
});
