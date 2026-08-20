import type { ActivationService } from "../activationService";
import { readTextIfExists } from "../fileUtils";
import type { TargetDiscoveryService } from "../targetDiscovery";
import { isTargetInstalled } from "../../shared/targetHealth";
import type { TargetRegistry } from "../targets/registry";
import type { IpcRegistrationHandles } from "./registration";

interface TargetIpcServices {
  activationService: ActivationService;
  targetDiscoveryService: TargetDiscoveryService;
  targetRegistry: TargetRegistry;
}

export const registerTargetIpc = (
  { diagnosticHandle }: Pick<IpcRegistrationHandles, "diagnosticHandle">,
  {
    activationService,
    targetDiscoveryService,
    targetRegistry
  }: TargetIpcServices
) => {
  diagnosticHandle("targets:list", (_event, forceRefresh: unknown) =>
    targetDiscoveryService.listTargets({ forceRefresh: forceRefresh === true })
  );
  diagnosticHandle("targets:probe-supported", (_event, forceRefresh: unknown) =>
    targetDiscoveryService.probeSupportedTargets({ forceRefresh: forceRefresh === true })
  );
  diagnosticHandle("targets:list-supported", () => targetRegistry.list());
  diagnosticHandle("targets:list-states", () => activationService.listTargetStates());
  diagnosticHandle("targets:list-native-mcps", async () => {
    const targets = await targetDiscoveryService.listTargets();
    const inspections = await Promise.all(
      targets
        .filter((target) => isTargetInstalled(target.health))
        .map(async (target) => {
          try {
            const captured = await targetRegistry.get(target.id).captureProfile(target.paths);
            return { connections: captured.mcpConnections ?? [], issues: [] };
          } catch (error) {
            return {
              connections: [],
              issues: [{
                targetId: target.id,
                targetName: target.name,
                sourcePath: target.paths.mcpConfigPath ?? target.paths.configPath,
                message: error instanceof Error ? error.message : String(error)
              }]
            };
          }
        })
    );
    return {
      connections: inspections
        .flatMap((inspection) => inspection.connections)
        .sort(
          (left, right) =>
            left.targetId.localeCompare(right.targetId) || left.name.localeCompare(right.name)
        ),
      issues: inspections.flatMap((inspection) => inspection.issues)
    };
  });
  diagnosticHandle("targets:list-native-instructions", async () => {
    const targets = await targetDiscoveryService.listTargets();
    const inspections = await Promise.all(
      targets
        .filter((target) => isTargetInstalled(target.health))
        .map(async (target) => {
          try {
            return {
              snapshot: {
                targetId: target.id,
                targetName: target.name,
                path: target.paths.instructionsPath,
                content: await readTextIfExists(target.paths.instructionsPath)
              },
              issue: undefined
            };
          } catch (error) {
            return {
              snapshot: undefined,
              issue: {
                targetId: target.id,
                targetName: target.name,
                path: target.paths.instructionsPath,
                message: error instanceof Error ? error.message : String(error)
              }
            };
          }
        })
    );
    return {
      snapshots: inspections.flatMap((inspection) =>
        inspection.snapshot ? [inspection.snapshot] : []
      ),
      issues: inspections.flatMap((inspection) => inspection.issue ? [inspection.issue] : [])
    };
  });
};
