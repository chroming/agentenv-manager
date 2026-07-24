import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { ConversationLaunchSpec } from "../targets/types";

const execFileAsync = promisify(execFile);

export interface ConversationLauncher {
  launch(spec: ConversationLaunchSpec): Promise<void>;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const terminalScriptFor = (
  scriptPath: string,
  spec: ConversationLaunchSpec
) => [
  "#!/bin/zsh",
  "set -e",
  `rm -f -- ${shellQuote(scriptPath)}`,
  ...(spec.cwd ? [`cd -- ${shellQuote(spec.cwd)}`] : []),
  `exec ${[spec.executablePath, ...spec.args].map(shellQuote).join(" ")}`
].join("\n") + "\n";

export const createConversationLauncher = (options: {
  artifactDir: string;
  platform?: NodeJS.Platform;
  openTerminal?: (scriptPath: string) => Promise<void>;
}): ConversationLauncher => {
  const platform = options.platform ?? process.platform;
  const openTerminal = options.openTerminal ?? (async (scriptPath: string) => {
    if (platform !== "darwin") {
      throw new Error("Direct conversation launch is currently available on macOS");
    }
    await execFileAsync("/usr/bin/open", ["-a", "Terminal", scriptPath], {
      timeout: 10_000
    });
  });
  return {
    launch: async (spec) => {
      await mkdir(options.artifactDir, { recursive: true, mode: 0o700 });
      const scriptPath = join(options.artifactDir, `launch-${randomUUID()}.command`);
      await writeFile(scriptPath, terminalScriptFor(scriptPath, spec), {
        encoding: "utf8",
        mode: 0o700
      });
      await chmod(scriptPath, 0o700);
      try {
        await openTerminal(scriptPath);
      } catch (error) {
        await import("node:fs/promises").then(({ rm }) => rm(scriptPath, { force: true }));
        throw error;
      }
    }
  };
};
