import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findExecutable } from "../../src/main/executableDiscovery";

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
    root = await mkdtemp(join(tmpdir(), "agentenv-executable-"));
    const executable = join(root, "shell-bin", "git");
    const shell = join(root, "login-shell");
    await executableFile(executable);
    await executableFile(shell, `#!/bin/sh\nprintf '%s\\n' '${executable}'\n`);

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

  it("accepts an executable absolute path and rejects unsafe command names", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-executable-"));
    const executable = join(root, "git");
    await executableFile(executable);

    await expect(findExecutable(executable, { homeDir: root })).resolves.toBe(executable);
    await expect(findExecutable("git; echo unsafe", { homeDir: root })).rejects.toThrow(
      "Executable name is invalid"
    );
  });
});
