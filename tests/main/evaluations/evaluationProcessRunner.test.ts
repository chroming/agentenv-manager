import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEvaluationProcessRunner,
  EvaluationProcessError
} from "../../../src/main/evaluations/evaluationProcessRunner";

let root = "";

const isolatedEnv = (path: string): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: path,
  USERPROFILE: path,
  XDG_CONFIG_HOME: path,
  XDG_DATA_HOME: path,
  XDG_CACHE_HOME: path,
  XDG_STATE_HOME: path,
  TMPDIR: path,
  TMP: path,
  TEMP: path,
  CODEX_HOME: path,
  OPENCODE_CONFIG_DIR: path
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("evaluation process runner", () => {
  it("reports unavailable isolation when the sandbox executable is missing", () => {
    const runner = createEvaluationProcessRunner({
      platform: "darwin",
      sandboxExecutablePath: "/path/that/does/not/exist"
    });
    expect(runner.isolationAvailability()).toEqual({
      available: false,
      reason: "The macOS process sandbox is unavailable"
    });
  });

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "rejects launch specifications that escape the disposable workspace",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-invalid-spec-"));
      const runner = createEvaluationProcessRunner();
      await expect(runner.run({
        executablePath: "/bin/sh",
        args: ["-c", "exit 0"],
        cwd: tmpdir(),
        env: isolatedEnv(root),
        writableRoot: root,
        fidelity: "full",
        warnings: []
      }, () => undefined)).rejects.toThrow("working directory is outside");
      await expect(runner.run({
        executablePath: "opencode",
        args: [],
        cwd: root,
        env: isolatedEnv(root),
        writableRoot: root,
        fidelity: "full",
        warnings: []
      }, () => undefined)).rejects.toThrow("absolute path");
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "terminates a child that exceeds the stderr budget",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-output-limit-"));
      const runner = createEvaluationProcessRunner({ maxStderrBytes: 16 });
      const error = await runner.run({
        executablePath: "/bin/sh",
        args: ["-c", "printf 'this output is intentionally too long' >&2; sleep 5"],
        cwd: root,
        env: isolatedEnv(root),
        writableRoot: root,
        fidelity: "full",
        warnings: []
      }, () => undefined).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(EvaluationProcessError);
      expect(error).toMatchObject({ reason: "output-limit" });
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "allows writes only inside the disposable workspace",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-sandbox-"));
      const writable = join(root, "writable");
      const forbidden = join(root, "forbidden.txt");
      await mkdir(writable);
      const runner = createEvaluationProcessRunner();
      const events: string[] = [];
      const result = await runner.run({
        executablePath: "/bin/sh",
        args: [
          "-c",
          `printf 'inside' > "$1/inside.txt"; if printf 'outside' > "$2"; then exit 9; fi; printf '{"type":"text","part":{"text":"done"}}\\n'`,
          "agentenv-eval",
          writable,
          forbidden
        ],
        cwd: writable,
        env: isolatedEnv(writable),
        writableRoot: writable,
        fidelity: "full",
        warnings: []
      }, (line) => ({ type: "response", text: line }), {
        onEvent: (event) => {
          if (event.type === "response") events.push(event.text);
        }
      });

      expect(result.exitCode).toBe(0);
      expect(await readFile(join(writable, "inside.txt"), "utf8")).toBe("inside");
      expect(existsSync(forbidden)).toBe(false);
      expect(events).toHaveLength(1);
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "does not allow a workspace symlink to escape the writable root",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-symlink-"));
      const writable = join(root, "writable");
      const forbidden = join(root, "forbidden");
      await Promise.all([mkdir(writable), mkdir(forbidden)]);
      await symlink(forbidden, join(writable, "escape"));
      const runner = createEvaluationProcessRunner();
      const result = await runner.run({
        executablePath: "/bin/sh",
        args: [
          "-c",
          "if printf 'outside' > \"$1/escape/escaped.txt\"; then exit 9; fi; exit 0",
          "agentenv-eval",
          writable
        ],
        cwd: writable,
        env: isolatedEnv(writable),
        writableRoot: writable,
        fidelity: "full",
        warnings: []
      }, () => undefined);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(forbidden, "escaped.txt"))).toBe(false);
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "prevents the comparison process from reading protected source folders",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-read-sandbox-"));
      const writable = join(root, "writable");
      const protectedRoot = join(root, "real-home");
      await Promise.all([mkdir(writable), mkdir(protectedRoot)]);
      await writeFile(join(writable, "visible.txt"), "isolated\n");
      await writeFile(join(protectedRoot, "secret.txt"), "private\n");
      const runner = createEvaluationProcessRunner();
      const result = await runner.run({
        executablePath: "/bin/sh",
        args: [
          "-c",
          "if cat \"$2/secret.txt\"; then exit 9; fi; cat \"$1/visible.txt\"",
          "agentenv-eval",
          writable,
          protectedRoot
        ],
        cwd: writable,
        env: isolatedEnv(writable),
        writableRoot: writable,
        readDeniedRoots: [protectedRoot],
        fidelity: "full",
        warnings: []
      }, () => undefined);

      expect(result.exitCode).toBe(0);
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "replaces inherited working-directory variables with the isolated workspace",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-working-directory-"));
      const writable = join(root, "writable");
      const originalWorkspace = join(root, "original-workspace");
      await Promise.all([mkdir(writable), mkdir(originalWorkspace)]);
      const runner = createEvaluationProcessRunner();
      const lines: string[] = [];
      const env = isolatedEnv(writable);
      env.PWD = originalWorkspace;
      env.OLDPWD = originalWorkspace;
      env.INIT_CWD = originalWorkspace;

      const result = await runner.run({
        executablePath: "/usr/bin/env",
        args: [],
        cwd: writable,
        env,
        writableRoot: writable,
        readDeniedRoots: [originalWorkspace],
        fidelity: "full",
        warnings: []
      }, (line) => ({ type: "response", text: line }), {
        onEvent: (event) => {
          if (event.type === "response") lines.push(event.text);
        }
      });

      expect(result.exitCode).toBe(0);
      expect(lines).toContain(`PWD=${await realpath(writable)}`);
      expect(lines.some((line) => line.startsWith("OLDPWD="))).toBe(false);
      expect(lines.some((line) => line.startsWith("INIT_CWD="))).toBe(false);
      expect(lines.join("\n")).not.toContain(originalWorkspace);
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "canonicalizes aliased isolated paths before launching the Agent",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-path-alias-"));
      const physical = join(root, "physical");
      const alias = join(root, "alias");
      await mkdir(join(physical, ".codex"), { recursive: true });
      await symlink(physical, alias, "dir");
      const runner = createEvaluationProcessRunner();
      const lines: string[] = [];
      const env = isolatedEnv(alias);
      env.CODEX_HOME = join(alias, ".codex");

      const result = await runner.run({
        executablePath: "/bin/sh",
        args: ["-c", "printf '%s\\n%s\\n' \"$HOME\" \"$CODEX_HOME\""],
        cwd: alias,
        env,
        writableRoot: alias,
        fidelity: "full",
        warnings: []
      }, (line) => ({ type: "response", text: line }), {
        onEvent: (event) => {
          if (event.type === "response") lines.push(event.text);
        }
      });

      expect(result.exitCode).toBe(0);
      expect(lines).toEqual([
        await realpath(physical),
        await realpath(join(physical, ".codex"))
      ]);
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "allows only the declared Agent runtime inside an otherwise protected Home",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-runtime-exception-"));
      const writable = join(root, "writable");
      const protectedHome = join(root, "real-home");
      const runtimeRoot = join(protectedHome, "tools", "opencode");
      const executable = join(runtimeRoot, "opencode");
      await Promise.all([mkdir(writable), mkdir(runtimeRoot, { recursive: true })]);
      await writeFile(join(writable, "visible.txt"), "isolated\n");
      await writeFile(executable, "#!/bin/sh\ncat \"$1/visible.txt\"\n");
      await chmod(executable, 0o700);
      const runner = createEvaluationProcessRunner();
      const result = await runner.run({
        executablePath: executable,
        args: [writable],
        cwd: writable,
        env: isolatedEnv(writable),
        writableRoot: writable,
        readDeniedRoots: [protectedHome],
        runtimeReadRoots: [runtimeRoot],
        fidelity: "full",
        warnings: []
      }, () => undefined);

      expect(result.exitCode).toBe(0);
      runner.dispose();
    }
  );

  it.skipIf(process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))(
    "cancels the entire evaluation process group",
    async () => {
      root = await mkdtemp(join(tmpdir(), "agentenv-evaluation-cancel-"));
      const runner = createEvaluationProcessRunner({ terminateGraceMs: 20 });
      const controller = new AbortController();
      const operation = runner.run({
        executablePath: "/bin/sh",
        args: ["-c", "sleep 10"],
        cwd: root,
        env: isolatedEnv(root),
        writableRoot: root,
        fidelity: "full",
        warnings: []
      }, () => undefined, { signal: controller.signal });
      controller.abort();
      const error = await operation.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(EvaluationProcessError);
      expect(error).toMatchObject({ reason: "cancelled" });
      runner.dispose();
    }
  );
});
