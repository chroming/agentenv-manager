import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitCommandRunner,
  GitCommandError
} from "../../../src/main/skillSources/gitCommandRunner";

let root = "";

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = "";
  }
});

const fakeGit = async (body: string) => {
  root = await mkdtemp(join(tmpdir(), "agentenv-git-runner-"));
  const executable = join(root, "git");
  await writeFile(executable, `#!/bin/sh\n${body}\n`, "utf8");
  await chmod(executable, 0o755);
  return executable;
};

describe("git command runner", () => {
  it("runs argument arrays without a shell and preserves credential environments", async () => {
    const executable = await fakeGit(
      'printf "prompt=%s\\nssh=%s\\narg=%s\\n" "$GIT_TERMINAL_PROMPT" "$SSH_AUTH_SOCK" "$1"'
    );
    const runner = createGitCommandRunner({
      executablePath: executable,
      env: { SSH_AUTH_SOCK: "/tmp/test-agent.sock" }
    });

    await expect(runner.run(["value; echo injected"])).resolves.toMatchObject({
      stdout: "prompt=0\nssh=/tmp/test-agent.sock\narg=value; echo injected\n",
      stderr: "",
      exitCode: 0
    });
  });

  it("prepends portable repository settings to every Git command", async () => {
    const executable = await fakeGit('printf "%s\\n" "$@"');
    const runner = createGitCommandRunner({
      executablePath: executable,
      argsPrefix: ["-c", "core.autocrlf=false"]
    });

    await expect(runner.run(["status"])).resolves.toMatchObject({
      stdout: "-c\ncore.autocrlf=false\nstatus\n"
    });
  });

  it("redacts embedded URL credentials from command failures", async () => {
    const executable = await fakeGit(
      'printf "%s\\n" "fatal: https://token:secret@example.test/team/skills.git" >&2; exit 7'
    );
    const runner = createGitCommandRunner({ executablePath: executable });

    const error = await runner.run(["fetch"]).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GitCommandError);
    expect(error).toMatchObject({ exitCode: 7 });
    expect(String(error)).toContain("https://***@example.test/team/skills.git");
    expect(String(error)).not.toContain("token");
    expect(String(error)).not.toContain("secret");
  });

  it("terminates commands that time out or are aborted", async () => {
    const executable = await fakeGit("sleep 5");
    const runner = createGitCommandRunner({ executablePath: executable, defaultTimeoutMs: 40 });

    await expect(runner.run(["fetch"])).rejects.toThrow("timed out");

    const controller = new AbortController();
    const operation = runner.run(["fetch"], { signal: controller.signal, timeoutMs: 5_000 });
    controller.abort();
    await expect(operation).rejects.toThrow("cancelled");
  });

  it("terminates active commands when disposed", async () => {
    const executable = await fakeGit("sleep 5");
    const runner = createGitCommandRunner({ executablePath: executable, defaultTimeoutMs: 5_000 });
    const operation = runner.run(["fetch"]);

    runner.dispose();

    await expect(operation).rejects.toThrow("cancelled");
    await expect(runner.run(["status"])).rejects.toThrow("disposed");
  });

  it("cancels active commands without disposing the runner", async () => {
    const executable = await fakeGit('if [ "$1" = "fetch" ]; then sleep 5; else printf "ready\\n"; fi');
    const runner = createGitCommandRunner({ executablePath: executable, defaultTimeoutMs: 5_000 });
    const operation = runner.run(["fetch"]);

    runner.cancelActive();

    await expect(operation).rejects.toThrow("cancelled");
    await expect(runner.run(["status"])).resolves.toMatchObject({ stdout: "ready\n" });
  });
});
