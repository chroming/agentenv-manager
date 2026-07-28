import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { ConversationLaunchSpec } from "../targets/types";
import type { AgentEnvSettings } from "../../shared/types";

const execFileAsync = promisify(execFile);

export interface ConversationLauncher {
  launch(spec: ConversationLaunchSpec): Promise<void>;
}

type ConversationTerminal = AgentEnvSettings["conversationTerminal"];

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const environmentName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const jsonFieldName = /^[A-Za-z_][A-Za-z0-9_]*$/;

const environmentLines = (spec: ConversationLaunchSpec) => {
  const names = [
    ...Object.keys(spec.env ?? {}),
    ...(spec.envToDelete ?? [])
  ];
  const invalid = names.find((name) => !environmentName.test(name));
  if (invalid) throw new Error(`Invalid launch environment name: ${invalid}`);
  return [
    ...[...new Set(spec.envToDelete ?? [])].map((name) => `unset ${name}`),
    ...Object.entries(spec.env ?? {}).map(
      ([name, value]) => `export ${name}=${shellQuote(value)}`
    )
  ];
};

export const terminalScriptFor = (
  scriptPath: string,
  spec: ConversationLaunchSpec
) => {
  const resume = spec.resumeAfterExit;
  if (resume && !jsonFieldName.test(resume.sessionIdField)) {
    throw new Error(`Invalid launch JSON field name: ${resume.sessionIdField}`);
  }
  const eventPath = `${scriptPath}.events`;
  const command = [spec.executablePath, ...spec.args].map(shellQuote).join(" ");
  const launchLines = resume
    ? [
        "umask 077",
        `events_path=${shellQuote(eventPath)}`,
        `trap 'rm -f -- \"$events_path\"' EXIT HUP INT TERM`,
        `print -r -- ${shellQuote("Preparing the interactive conversation...")}`,
        `${command} > \"$events_path\"`,
        `session_id=$(/usr/bin/grep -Eo ${shellQuote(
          `"${resume.sessionIdField}"[[:space:]]*:[[:space:]]*"[^"]+"`
        )} \"$events_path\" | /usr/bin/head -n 1 | /usr/bin/sed -E ${shellQuote(
          `s/.*"${resume.sessionIdField}"[[:space:]]*:[[:space:]]*"([^"]+)".*/\\1/`
        )})`,
        "if [[ -z \"$session_id\" ]]; then",
        `  print -u2 -r -- ${shellQuote("OpenCode created no resumable session.")}`,
        "  exit 1",
        "fi",
        "rm -f -- \"$events_path\"",
        "trap - EXIT HUP INT TERM",
        `exec ${[
          spec.executablePath,
          ...resume.argsBeforeSessionId
        ].map(shellQuote).join(" ")} "$session_id"${
          resume.argsAfterSessionId?.length
            ? ` ${resume.argsAfterSessionId.map(shellQuote).join(" ")}`
            : ""
        }`
      ]
    : [`exec ${command}`];
  return [
    "#!/bin/zsh",
    "set -e",
    `rm -f -- ${shellQuote(scriptPath)}`,
    ...environmentLines(spec),
    ...(spec.cwd ? [`cd -- ${shellQuote(spec.cwd)}`] : []),
    ...launchLines
  ].join("\n") + "\n";
};

export const terminalOpenArgumentsFor = (
  terminal: ConversationTerminal,
  scriptPath: string
) => terminal === "ghostty"
  ? ["-a", "Ghostty", scriptPath]
  : [scriptPath];

export const createConversationLauncher = (options: {
  artifactDir: string;
  platform?: NodeJS.Platform;
  terminalPreference?: () => Promise<ConversationTerminal>;
  openTerminal?: (scriptPath: string, terminal: ConversationTerminal) => Promise<void>;
}): ConversationLauncher => {
  const platform = options.platform ?? process.platform;
  const terminalPreference = options.terminalPreference ?? (async () => "default" as const);
  const openTerminal = options.openTerminal ?? (async (
    scriptPath: string,
    terminal: ConversationTerminal
  ) => {
    if (platform !== "darwin") {
      throw new Error("Direct conversation launch is currently available on macOS");
    }
    try {
      await execFileAsync(
        "/usr/bin/open",
        terminalOpenArgumentsFor(terminal, scriptPath),
        { timeout: 10_000 }
      );
    } catch (error) {
      if (terminal === "ghostty") {
        throw new Error(
          `Ghostty is not installed or could not open this conversation: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      throw error;
    }
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
        await openTerminal(scriptPath, await terminalPreference());
      } catch (error) {
        await import("node:fs/promises").then(({ rm }) => rm(scriptPath, { force: true }));
        throw error;
      }
    }
  };
};
