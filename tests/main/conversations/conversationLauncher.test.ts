import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConversationLauncher,
  terminalOpenArgumentsFor,
  terminalScriptFor
} from "../../../src/main/conversations/conversationLauncher";

let root = "";

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
