import { basename, join } from "node:path";
import type { TargetDiscoveryDriver } from "./contract";
import type {
  TargetInstallationInput,
  TargetInstallationResult
} from "./types";

interface MacApplicationProbe {
  bundleName: string;
  label: string;
  bundleIdentifier?: string;
  bundledExecutable?: {
    relativePath: string;
    label: string;
    versionArgs?: string[];
  };
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

    let runtime: TargetInstallationResult["runtime"];
    if (input.platform === "darwin") {
      const applicationCandidates: Array<{
        path: string;
        probe: MacApplicationProbe;
      }> = [];
      for (const probe of macApplications) {
        applicationCandidates.push({
          path: join(input.homeDir, "Applications", probe.bundleName),
          probe
        });
        if (input.allowSystemApplicationLookup) {
          applicationCandidates.push({
            path: join("/Applications", probe.bundleName),
            probe
          });
        }
      }
      if (
        input.allowSystemApplicationLookup &&
        input.findMacApplicationsByBundleIdentifier
      ) {
        const bundleIdentifiers = [...new Set(macApplications
          .map((probe) => probe.bundleIdentifier)
          .filter((value): value is string => Boolean(value)))];
        for (const bundleIdentifier of bundleIdentifiers) {
          for (const path of await input.findMacApplicationsByBundleIdentifier(bundleIdentifier)) {
            const probe = macApplications.find((candidate) =>
              candidate.bundleIdentifier === bundleIdentifier &&
              candidate.bundleName === basename(path)
            ) ?? macApplications.find((candidate) =>
              candidate.bundleIdentifier === bundleIdentifier
            );
            if (probe) applicationCandidates.push({ path, probe });
          }
        }
      }

      const verifiedApplications: typeof applicationCandidates = [];
      const observedPaths = new Set<string>();
      for (const candidate of applicationCandidates) {
        if (observedPaths.has(candidate.path)) continue;
        observedPaths.add(candidate.path);
        if (!await input.pathExists(candidate.path)) continue;
        if (candidate.probe.bundleIdentifier) {
          const actualBundleIdentifier =
            await input.readMacApplicationBundleIdentifier?.(candidate.path);
          if (actualBundleIdentifier !== candidate.probe.bundleIdentifier) continue;
        }
        verifiedApplications.push(candidate);
        evidence.push({
          kind: "desktop-app",
          label: candidate.probe.label,
          path: candidate.path
        });
      }

      const commandFound = evidence.some((item) => item.kind === "command");
      if (!commandFound) {
        for (const candidate of verifiedApplications) {
          const bundledExecutable = candidate.probe.bundledExecutable;
          if (!bundledExecutable) continue;
          const path = join(candidate.path, bundledExecutable.relativePath);
          const probeResult = input.probeExecutable
            ? await input.probeExecutable(path, bundledExecutable.versionArgs)
            : {
                status: "unknown" as const,
                error: "Bundled runtime could not be checked"
              };
          const candidateRuntime: NonNullable<TargetInstallationResult["runtime"]> = {
            source: "bundled-runtime",
            label: bundledExecutable.label,
            path,
            ...probeResult
          };
          runtime ??= candidateRuntime;
          if (probeResult.status === "found") {
            runtime = candidateRuntime;
            break;
          }
        }
      }
    }

    return {
      found: evidence.length > 0,
      evidence,
      ...(runtime ? { runtime } : {})
    };
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
