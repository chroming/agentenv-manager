import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExecutableSearchPaths,
  createExecutableResolver,
  findExecutable
} from "../../src/main/executableDiscovery";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

const executableFile = async (path: string, content = "#!/bin/sh\nexit 0\n") => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
  await chmod(path, 0o755);
};

describe("executable discovery", () => {
  it("finds executables from the supplied PATH", async () => {
    if (process.platform === "win32") return;
    root = await mkdtemp(join(tmpdir(), "agentenv-executable-"));
    const binDir = join(root, "bin");
    const executable = join(binDir, "git");
    await executableFile(executable);

    await expect(
      findExecutable("git", {
        homeDir: root,
        pathEnv: binDir,
        systemPathLookup: false,
        shellPathLookup: false
      })
    ).resolves.toBe(executable);
  });

  it.each(["opencode", "claude", "codex", "agy"])(
    "finds %s in common user bins when a desktop app PATH is sparse",
    async (command) => {
      if (process.platform === "win32") return;
      root = await mkdtemp(join(tmpdir(), "agentenv-executable-"));
      const executable = join(root, ".local", "bin", command);
      await executableFile(executable);

      await expect(
        findExecutable(command, {
          homeDir: root,
          pathEnv: "",
          systemPathLookup: false,
          shellPathLookup: false
        })
      ).resolves.toBe(executable);
    }
  );

  it("uses a bounded login-shell lookup as the final fallback", async () => {
    if (process.platform === "win32") return;
    root = await mkdtemp(join(tmpdir(), "agentenv-executable-"));
    const executable = join(root, "shell-bin", "git");
    const shell = join(root, "login-shell");
    await executableFile(executable);
    await executableFile(shell, `#!/bin/sh\nprintf '%s' '${join(root, "shell-bin")}'\n`);

    await expect(
      findExecutable("git", {
        homeDir: root,
        pathEnv: "",
        systemPathLookup: false,
        shellPathLookup: true,
        shellCandidates: [shell],
        shellTimeoutMs: 2_000
      })
    ).resolves.toBe(executable);
  });

  it("hydrates the login-shell PATH once for multiple command probes", async () => {
    if (process.platform === "win32") return;
    root = await mkdtemp(join(tmpdir(), "agentenv-executable-"));
    const binDir = join(root, "shell-bin");
    const shell = join(root, "login-shell");
    const counter = join(root, "shell-count");
    await executableFile(join(binDir, "codex"));
    await executableFile(join(binDir, "claude"));
    await executableFile(
      shell,
      `#!/bin/sh\nprintf x >> '${counter}'\nprintf '%s' '${binDir}'\n`
    );
    const resolver = createExecutableResolver({
      homeDir: root,
      pathEnv: "",
      systemPathLookup: false,
      shellPathLookup: true,
      shellCandidates: [shell]
    });

    await expect(resolver.find("codex")).resolves.toBe(join(binDir, "codex"));
    await expect(resolver.find("claude")).resolves.toBe(join(binDir, "claude"));
    await expect(readFile(counter, "utf8")).resolves.toBe("x");
  });

  it("accepts an executable absolute path and rejects unsafe command names", async () => {
    if (process.platform === "win32") return;
    root = await mkdtemp(join(tmpdir(), "agentenv-executable-"));
    const executable = join(root, "git");
    await executableFile(executable);

    await expect(findExecutable(executable, { homeDir: root })).resolves.toBe(executable);
    await expect(findExecutable("git; echo unsafe", { homeDir: root })).rejects.toThrow(
      "Executable name is invalid"
    );
  });

  it("uses PATHEXT and common user bins on Windows without a login shell", async () => {
    const existing = new Set([
      String.raw`C:\Users\tester\AppData\Roaming\npm\codex.cmd`
    ]);
    const checked: string[] = [];
    const resolver = createExecutableResolver({
      homeDir: String.raw`C:\Users\tester`,
      pathEnv: "",
      platform: "win32",
      environment: {
        APPDATA: String.raw`C:\Users\tester\AppData\Roaming`,
        LOCALAPPDATA: String.raw`C:\Users\tester\AppData\Local`,
        PATHEXT: ".EXE;.CMD"
      },
      systemPathLookup: false,
      shellPathLookup: true,
      canExecute: async (path) => {
        checked.push(path);
        return existing.has(path);
      }
    });

    await expect(resolver.find("codex")).resolves.toBe(
      String.raw`C:\Users\tester\AppData\Roaming\npm\codex.cmd`
    );
    expect(checked).toContain(
      String.raw`C:\Users\tester\AppData\Roaming\npm\codex.cmd`
    );
  });

  it("includes configured package-manager homes on every platform", () => {
    expect(
      createExecutableSearchPaths("", "/home/tester", false, {
        platform: "linux",
        environment: {
          PNPM_HOME: "/opt/pnpm",
          BUN_INSTALL: "/opt/bun",
          VOLTA_HOME: "/opt/volta",
          NPM_CONFIG_PREFIX: "/opt/npm",
          XDG_DATA_HOME: "/home/tester/.data"
        }
      })
    ).toEqual(expect.arrayContaining([
      "/opt/pnpm",
      "/opt/bun/bin",
      "/opt/volta/bin",
      "/opt/npm/bin",
      "/home/tester/.data/pnpm"
    ]));
    expect(
      createExecutableSearchPaths("", String.raw`C:\Users\tester`, false, {
        platform: "win32",
        environment: {
          PNPM_HOME: String.raw`C:\Tools\pnpm`,
          NPM_CONFIG_PREFIX: String.raw`C:\Tools\npm`
        }
      })
    ).toEqual(expect.arrayContaining([
      String.raw`C:\Tools\pnpm`,
      String.raw`C:\Tools\npm`
    ]));
  });
});
