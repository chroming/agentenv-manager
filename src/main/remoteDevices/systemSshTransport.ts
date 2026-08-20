import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { RemoteDevice } from "../../shared/types";
import { createExecutableResolver } from "../executableDiscovery";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface SshCommandResult {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
}

export interface SshTransport {
  execute(
    device: RemoteDevice,
    remoteCommand: string,
    options?: { input?: Buffer; timeoutMs?: number; maxOutputBytes?: number }
  ): Promise<SshCommandResult>;
}

const deviceDestination = (device: RemoteDevice) =>
  device.user ? `${device.user}@${device.host}` : device.host;

export const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

export const createSystemSshTransport = (options: {
  homeDir: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  pathEnv?: string;
}): SshTransport => {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const resolver = createExecutableResolver({
    homeDir: options.homeDir,
    platform,
    environment,
    pathEnv: options.pathEnv ?? environment.PATH ?? "",
    systemPathLookup: true,
    shellPathLookup: true
  });

  return {
    execute: async (device, remoteCommand, commandOptions = {}) => {
      const executable = await resolver.find("ssh");
      if (!executable) throw new Error("System OpenSSH was not found");
      const args = [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=8",
        "-o", "ServerAliveInterval=5",
        "-o", "ServerAliveCountMax=2",
        ...(device.port ? ["-p", String(device.port)] : []),
        "--",
        deviceDestination(device),
        remoteCommand
      ];
      return await new Promise<SshCommandResult>((resolve, reject) => {
        const child = spawn(executable, args, {
          env: environment,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let outputBytes = 0;
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGTERM");
          reject(new Error("SSH operation timed out"));
        }, commandOptions.timeoutMs ?? 30_000);
        const collect = (chunks: Buffer[], chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > (commandOptions.maxOutputBytes ?? MAX_OUTPUT_BYTES)) {
            child.kill("SIGTERM");
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(new Error("SSH operation produced too much output"));
            }
            return;
          }
          chunks.push(chunk);
        };
        child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
        child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
        child.on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.on("close", (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr).toString("utf8").trim(),
            exitCode: code ?? 1
          });
        });
        child.stdin.on("error", () => undefined);
        child.stdin.end(commandOptions.input);
      });
    }
  };
};

export const remoteDeviceFingerprint = (input: {
  homeDir: string;
  platform: string;
  architecture: string;
  machineId?: string;
}) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
