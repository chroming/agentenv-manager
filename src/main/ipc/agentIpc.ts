import type { ActivationService } from "../activationService";
import type { RemoteActivationService } from "../remoteDevices/remoteActivationService";
import type { TargetDiscoveryService } from "../targetDiscovery";
import type { TargetRegistry } from "../targets/registry";
import type { IpcRegistrationHandles } from "./registration";
import { registerRemoteDeviceIpc } from "./remoteDeviceIpc";
import { registerTargetIpc } from "./targetIpc";

export const registerAgentIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle" | "handleMutation">,
  services: {
    activationService: ActivationService;
    remoteActivationService: RemoteActivationService;
    targetDiscoveryService: TargetDiscoveryService;
    targetRegistry: TargetRegistry;
  }
) => {
  registerTargetIpc(
    { diagnosticHandle: handles.diagnosticHandle },
    services
  );
  registerRemoteDeviceIpc(handles, services);
};
