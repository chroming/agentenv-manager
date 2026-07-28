import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConversationLauncher,
  terminalOpenArgumentsFor,
  terminalScriptFor
} from "../../../src/main/conversations/conversationLauncher";

let root = "";
const execFileAsync = promisify(execFile);
const shellPath = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("conversation launcher", () => {
  it("quotes every command argument and removes the script before launch", () => {
    const script = terminalScriptFor("/tmp/launch file.command", {
      executablePath: "/Applications/Agent Tool",
      args: ["--file", "/tmp/context with 'quote'.md"],
      cwd: "/tmp/project directory",
      env: { CODEX_HOME: "/tmp/custom codex" },
      envToDelete: ["OPENCODE_CONFIG_DIR"]
    });

    expect(script).toContain("rm -f -- '/tmp/launch file.command'");
    expect(script).toContain("cd -- '/tmp/project directory'");
    expect(script).toContain("unset OPENCODE_CONFIG_DIR");
    expect(script).toContain("export CODEX_HOME='/tmp/custom codex'");
    expect(script).toContain(
      "exec '/Applications/Agent Tool' '--file' '/tmp/context with '\\''quote'\\''.md'"
    );
  });

  it("rejects unsafe environment variable names", () => {
    expect(() => terminalScriptFor("/tmp/launch.command", {
      executablePath: "/usr/bin/true",
      args: [],
      env: { "BAD-NAME": "value" }
    })).toThrow("Invalid launch environment name");
  });

  it("resumes a JSON-created session in the full interactive client", () => {
    const script = terminalScriptFor("/tmp/launch.command", {
      executablePath: "/usr/local/bin/opencode",
      args: [
        "run",
        "--file",
        "/tmp/handoff.md",
        "--format",
        "json",
        "Continue with the attached context."
      ],
      cwd: "/work/project",
      resumeAfterExit: {
        kind: "json-session",
        sessionIdField: "sessionID",
        argsBeforeSessionId: ["/work/project", "--session"]
      }
    });

    expect(script).toContain(
      "'/usr/local/bin/opencode' 'run' '--file' '/tmp/handoff.md' '--format' 'json'"
    );
    expect(script).toContain('"sessionID"[[:space:]]*:[[:space:]]*"[^"]+"');
    expect(script).toContain(
      "exec '/usr/local/bin/opencode' '/work/project' '--session' \"$session_id\""
    );
    expect(script).toContain("trap 'rm -f -- \"$events_path\"' EXIT HUP INT TERM");
  });

  it("rejects unsafe JSON field names in resumable launches", () => {
    expect(() => terminalScriptFor("/tmp/launch.command", {
      executablePath: "/usr/bin/true",
      args: [],
      resumeAfterExit: {
        kind: "json-session",
        sessionIdField: "sessionID; rm -rf /",
        argsBeforeSessionId: ["--session"]
      }
    })).toThrow("Invalid launch JSON field name");
  });

  it("executes the JSON bootstrap and then opens the captured interactive session", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-resume-"));
    const executablePath = join(root, "fake-opencode");
    const invocationLog = join(root, "invocations.log");
    const scriptPath = join(root, "launch.command");
    await writeFile(executablePath, [
      "#!/bin/zsh",
      `print -r -- \"$*\" >> ${shellPath(invocationLog)}`,
      "if [[ \"$1\" == \"run\" ]]; then",
      "  print -r -- '{\"type\":\"text\",\"sessionID\":\"ses_test_123\"}'",
      "fi"
    ].join("\n") + "\n", "utf8");
    await chmod(executablePath, 0o755);
    await writeFile(scriptPath, terminalScriptFor(scriptPath, {
      executablePath,
      args: ["run", "--file", join(root, "handoff.md"), "--format", "json"],
      cwd: root,
      resumeAfterExit: {
        kind: "json-session",
        sessionIdField: "sessionID",
        argsBeforeSessionId: [root, "--session"]
      }
    }), "utf8");
    await chmod(scriptPath, 0o755);

    await execFileAsync("/bin/zsh", [scriptPath]);

    expect((await readFile(invocationLog, "utf8")).trim().split("\n")).toEqual([
      `run --file ${join(root, "handoff.md")} --format json`,
      `${root} --session ses_test_123`
    ]);
    await expect(readFile(`${scriptPath}.events`, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("passes only a temporary script path to the selected terminal", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-launch-"));
    let openedPath = "";
    let openedTerminal = "";
    const launcher = createConversationLauncher({
      artifactDir: root,
      terminalPreference: async () => "ghostty",
      openTerminal: async (path, terminal) => {
        openedPath = path;
        openedTerminal = terminal;
      }
    });
    const privateContext = "private transcript content";

    await launcher.launch({
      executablePath: "/usr/bin/printf",
      args: ["Read /tmp/context.md"]
    });

    expect(openedPath).toMatch(/\.command$/);
    expect(openedTerminal).toBe("ghostty");
    expect(openedPath).not.toContain(privateContext);
    expect(await readFile(openedPath, "utf8")).not.toContain(privateContext);
  });

  it("delegates to the macOS default handler or explicitly opens Ghostty", () => {
    expect(terminalOpenArgumentsFor("default", "/tmp/launch.command")).toEqual([
      "/tmp/launch.command"
    ]);
    expect(terminalOpenArgumentsFor("ghostty", "/tmp/launch.command")).toEqual([
      "-a",
      "Ghostty",
      "/tmp/launch.command"
    ]);
  });
});
