import { join } from "node:path";
import type { TargetDiscoveryDriver } from "./contract";
import type {
  TargetInstallationInput,
  TargetInstallationResult
} from "./types";

export const createCommandInstallationDriver = (
  executableName: string
): TargetDiscoveryDriver => ({
  detectInstallation: async (input): Promise<TargetInstallationResult> => {
    const path = await input.findExecutable(executableName);
    return {
      found: Boolean(path),
      evidence: path
        ? [{ kind: "command", label: `${executableName} command`, path }]
        : []
    };
  }
});

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

    if (input.platform === "darwin") {
      const candidates = [join(input.homeDir, "Applications", "Antigravity.app")];
      if (input.allowSystemApplicationLookup) {
        candidates.push("/Applications/Antigravity.app");
      }
      for (const path of candidates) {
        if (await input.pathExists(path)) {
          evidence.push({ kind: "desktop-app", label: "Antigravity application", path });
          break;
        }
      }
    }

    return { found: evidence.length > 0, evidence };
  }
});
