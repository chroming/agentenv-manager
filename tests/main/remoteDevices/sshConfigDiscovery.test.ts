import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSshConfigDiscovery,
  readSshConfigAliases
} from "../../../src/main/remoteDevices/sshConfigDiscovery";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createHome = async () => {
  const root = await mkdtemp(join(tmpdir(), "agentenv-ssh-config-"));
  roots.push(root);
  await mkdir(join(root, ".ssh", "hosts"), { recursive: true });
  return root;
};

describe("SSH config discovery", () => {
  it("lists concrete Host aliases from the user config and recursive Includes", async () => {
    const homeDir = await createHome();
    await writeFile(join(homeDir, ".ssh", "config"), [
      "Host *",
      "  ServerAliveInterval 30",
      "Include hosts/*.conf",
      "Host build-a quoted-host",
      "Host *.internal !blocked"
    ].join("\n"));
    await writeFile(join(homeDir, ".ssh", "hosts", "a.conf"), [
      "Host staging",
      "  HostName staging.internal",
      "Include config"
    ].join("\n"));
    await writeFile(join(homeDir, ".ssh", "hosts", "b.conf"), "Host build-a\n");

    await expect(readSshConfigAliases(homeDir)).resolves.toEqual([
      { alias: "build-a" },
      { alias: "quoted-host" },
      { alias: "staging" }
    ]);
  });

  it("returns an empty list when the user has no SSH config", async () => {
    const homeDir = await createHome();
    await expect(readSshConfigAliases(homeDir)).resolves.toEqual([]);
  });

  it("uses ssh -G to preview the selected alias without connecting", async () => {
    const homeDir = await createHome();
    const binDir = join(homeDir, "bin");
    const executable = join(binDir, process.platform === "win32" ? "ssh.exe" : "ssh");
    await mkdir(binDir, { recursive: true });
    await writeFile(executable, "", "utf8");
    if (process.platform !== "win32") await chmod(executable, 0o755);
    const run = vi.fn().mockResolvedValue({
      stdout: "hostname 10.0.0.12\nuser deploy\nport 2202\nproxyjump bastion\n",
      stderr: "",
      exitCode: 0
    });
    const discovery = createSshConfigDiscovery({
      homeDir,
      pathEnv: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      run
    });

    await expect(discovery.resolveHost("build-prod")).resolves.toEqual({
      alias: "build-prod",
      hostName: "10.0.0.12",
      user: "deploy",
      port: 2202
    });
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("ssh"),
      ["-G", "-F", join(homeDir, ".ssh", "config"), "--", "build-prod"],
      process.env
    );
  });

  it("rejects wildcard or option-like aliases before spawning ssh", async () => {
    const homeDir = await createHome();
    const discovery = createSshConfigDiscovery({ homeDir, run: vi.fn() });
    await expect(discovery.resolveHost("*.internal")).rejects.toThrow("Invalid SSH config host");
    await expect(discovery.resolveHost("-oProxyCommand=bad")).rejects.toThrow("Invalid SSH config host");
  });
});
