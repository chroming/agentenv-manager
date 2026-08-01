import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
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
