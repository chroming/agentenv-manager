import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
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

const validateEnvironment = (spec: ConversationLaunchSpec) => {
  const names = [
    ...Object.keys(spec.env ?? {}),
    ...(spec.envToDelete ?? [])
  ];
  const invalid = names.find((name) => !environmentName.test(name));
  if (invalid) throw new Error(`Invalid launch environment name: ${invalid}`);
};

const environmentLines = (spec: ConversationLaunchSpec) => {
  validateEnvironment(spec);
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
        `printf '%s\\n' ${shellQuote("Preparing the interactive conversation...")}`,
        `${command} > \"$events_path\"`,
        `session_id=$(grep -Eo ${shellQuote(
          `"${resume.sessionIdField}"[[:space:]]*:[[:space:]]*"[^"]+"`
        )} \"$events_path\" | head -n 1 | sed -E ${shellQuote(
          `s/.*"${resume.sessionIdField}"[[:space:]]*:[[:space:]]*"([^"]+)".*/\\1/`
        )})`,
        "if [ -z \"$session_id\" ]; then",
        `  printf '%s\\n' ${shellQuote("OpenCode created no resumable session.")} >&2`,
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
    "#!/bin/sh",
    "set -e",
    `rm -f -- ${shellQuote(scriptPath)}`,
    ...environmentLines(spec),
    ...(spec.cwd ? [`cd -- ${shellQuote(spec.cwd)}`] : []),
    ...launchLines
  ].join("\n") + "\n";
};

const powerShellQuote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export const powerShellScriptFor = (
  scriptPath: string,
  spec: ConversationLaunchSpec
) => {
  validateEnvironment(spec);
  const resume = spec.resumeAfterExit;
  if (resume && !jsonFieldName.test(resume.sessionIdField)) {
    throw new Error(`Invalid launch JSON field name: ${resume.sessionIdField}`);
  }
  const invocation = (executablePath: string, args: string[]) =>
    `& ${[executablePath, ...args].map(powerShellQuote).join(" ")}`;
  const eventPath = `${scriptPath}.events`;
  const launchLines = resume
    ? [
        `$eventsPath = ${powerShellQuote(eventPath)}`,
        `Write-Host ${powerShellQuote("Preparing the interactive conversation...")}`,
        `${invocation(spec.executablePath, spec.args)} | Out-File -LiteralPath $eventsPath -Encoding utf8`,
        "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
        "$sessionId = Get-Content -LiteralPath $eventsPath | ForEach-Object {",
        "  try {",
        "    $event = $_ | ConvertFrom-Json",
        `    $value = $event.PSObject.Properties[${powerShellQuote(resume.sessionIdField)}].Value`,
        "    if ($value) { $value }",
        "  } catch {}",
        "} | Select-Object -First 1",
        "Remove-Item -LiteralPath $eventsPath -Force -ErrorAction SilentlyContinue",
        "if (-not $sessionId) {",
        `  [Console]::Error.WriteLine(${powerShellQuote("OpenCode created no resumable session.")})`,
        "  exit 1",
        "}",
        `${invocation(spec.executablePath, resume.argsBeforeSessionId)} $sessionId${
          resume.argsAfterSessionId?.length
            ? ` ${resume.argsAfterSessionId.map(powerShellQuote).join(" ")}`
            : ""
        }`,
        "exit $LASTEXITCODE"
      ]
    : [
        invocation(spec.executablePath, spec.args),
        "exit $LASTEXITCODE"
      ];
  return [
    "$ErrorActionPreference = 'Stop'",
    "Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue",
    ...[...new Set(spec.envToDelete ?? [])].map(
      (name) => `Remove-Item Env:${name} -ErrorAction SilentlyContinue`
    ),
    ...Object.entries(spec.env ?? {}).map(
      ([name, value]) => `$env:${name} = ${powerShellQuote(value)}`
    ),
    ...(spec.cwd ? [`Set-Location -LiteralPath ${powerShellQuote(spec.cwd)}`] : []),
    ...launchLines
  ].join("\r\n") + "\r\n";
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
  const launchDetached = (command: string, args: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        detached: true,
        shell: false,
        stdio: "ignore",
        windowsHide: false
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  const openTerminal = options.openTerminal ?? (async (
    scriptPath: string,
    terminal: ConversationTerminal
  ) => {
    if (platform === "darwin") {
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
      return;
    }
    if (platform === "win32") {
      const powershell = process.env.SystemRoot
        ? join(
            process.env.SystemRoot,
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe"
          )
        : "powershell.exe";
      await launchDetached(powershell, [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath
      ]);
      return;
    }
    const candidates: Array<{ command: string; args: string[] }> =
      terminal === "ghostty"
        ? [{ command: "ghostty", args: ["-e", scriptPath] }]
        : [
            { command: "xdg-terminal-exec", args: [scriptPath] },
            { command: "x-terminal-emulator", args: ["-e", scriptPath] },
            { command: "gnome-terminal", args: ["--", scriptPath] },
            { command: "konsole", args: ["-e", scriptPath] },
            { command: "kitty", args: [scriptPath] },
            { command: "ghostty", args: ["-e", scriptPath] }
          ];
    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        await launchDetached(candidate.command, candidate.args);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(
      `No supported terminal could open this conversation: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  });
  return {
    launch: async (spec) => {
      await mkdir(options.artifactDir, { recursive: true, mode: 0o700 });
      const extension =
        platform === "win32" ? "ps1" : platform === "darwin" ? "command" : "sh";
      const scriptPath = join(options.artifactDir, `launch-${randomUUID()}.${extension}`);
      const script =
        platform === "win32"
          ? powerShellScriptFor(scriptPath, spec)
          : terminalScriptFor(scriptPath, spec);
      await writeFile(scriptPath, script, {
        encoding: "utf8",
        mode: 0o700
      });
      if (platform !== "win32") await chmod(scriptPath, 0o700);
      try {
        await openTerminal(scriptPath, await terminalPreference());
      } catch (error) {
        await rm(scriptPath, { force: true });
        throw error;
      }
    }
  };
};
