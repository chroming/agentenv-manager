import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConversationLauncher,
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
      cwd: "/tmp/project directory"
    });

    expect(script).toContain("rm -f -- '/tmp/launch file.command'");
    expect(script).toContain("cd -- '/tmp/project directory'");
    expect(script).toContain(
      "exec '/Applications/Agent Tool' '--file' '/tmp/context with '\\''quote'\\''.md'"
    );
  });

  it("passes only a temporary script path to Terminal", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-conversation-launch-"));
    let openedPath = "";
    const launcher = createConversationLauncher({
      artifactDir: root,
      openTerminal: async (path) => {
        openedPath = path;
      }
    });
    const privateContext = "private transcript content";

    await launcher.launch({
      executablePath: "/usr/bin/printf",
      args: ["Read /tmp/context.md"]
    });

    expect(openedPath).toMatch(/\.command$/);
    expect(openedPath).not.toContain(privateContext);
    expect(await readFile(openedPath, "utf8")).not.toContain(privateContext);
  });
});
