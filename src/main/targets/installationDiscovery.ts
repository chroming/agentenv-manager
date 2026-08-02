import { join } from "node:path";
import type { TargetDiscoveryDriver } from "./contract";
import type {
  TargetInstallationInput,
  TargetInstallationResult
} from "./types";

interface MacApplicationProbe {
  bundleName: string;
  label: string;
}

interface InstallationDriverOptions {
  commands: string[];
  macApplications?: MacApplicationProbe[];
}

export const createInstallationDriver = ({
  commands,
  macApplications = []
}: InstallationDriverOptions): TargetDiscoveryDriver => ({
  detectInstallation: async (input): Promise<TargetInstallationResult> => {
    const evidence: TargetInstallationResult["evidence"] = [];

    for (const command of commands) {
      const path = await input.findExecutable(command);
      if (path) {
        evidence.push({ kind: "command", label: `${command} command`, path });
      }
    }

    if (input.platform === "darwin") {
      for (const application of macApplications) {
        const userPath = join(input.homeDir, "Applications", application.bundleName);
        if (await input.pathExists(userPath)) {
          evidence.push({ kind: "desktop-app", label: application.label, path: userPath });
        }

        if (input.allowSystemApplicationLookup) {
          const systemPath = join("/Applications", application.bundleName);
          if (await input.pathExists(systemPath)) {
            evidence.push({ kind: "desktop-app", label: application.label, path: systemPath });
          }
        }
      }
    }

    return { found: evidence.length > 0, evidence };
  }
});

export const createCommandInstallationDriver = (
  executableName: string
): TargetDiscoveryDriver => createInstallationDriver({ commands: [executableName] });

export const createAntigravityInstallationDriver = (): TargetDiscoveryDriver => ({
  detectInstallation: async (input: TargetInstallationInput) => {
    const evidence: TargetInstallationResult["evidence"] = [];
    const executablePath = await input.findExecutable("agy");
    if (executablePath) {
      evidence.push({ kind: "command", label: "agy command", path: executablePath });
    } else if (input.platform === "win32") {
      const defaultWindowsPath = join(
        input.homeDir,
        "AppData",
        "Local",
        "agy",
        "bin",
        "agy.exe"
      );
      if (await input.pathExists(defaultWindowsPath)) {
        evidence.push({ kind: "command", label: "agy command", path: defaultWindowsPath });
      }
    }

    return { found: evidence.length > 0, evidence };
  }
});
