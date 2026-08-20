import type { RemoteActivationService } from "../remoteDevices/remoteActivationService";
import type { IpcRegistrationHandles } from "./registration";

export const registerRemoteDeviceIpc = (
  { diagnosticHandle, handleMutation }: Pick<
    IpcRegistrationHandles,
    "diagnosticHandle" | "handleMutation"
  >,
  { remoteActivationService }: { remoteActivationService: RemoteActivationService }
) => {
  diagnosticHandle("remote-devices:list", () => remoteActivationService.listDevices());
  handleMutation("remote-devices:add", (_event, input) =>
    remoteActivationService.addDevice(input)
  );
  handleMutation("remote-devices:update", (_event, input) =>
    remoteActivationService.updateDevice(input)
  );
  handleMutation("remote-devices:remove", (_event, id: unknown) =>
    remoteActivationService.removeDevice(String(id))
  );
  diagnosticHandle("remote-devices:probe", (_event, id: unknown) =>
    remoteActivationService.probeDevice(String(id), true)
  );
  diagnosticHandle("remote-endpoints:list", (_event, forceRefresh: unknown) =>
    remoteActivationService.listEndpoints(forceRefresh === true)
  );
  diagnosticHandle("remote-endpoints:list-states", () =>
    remoteActivationService.listTargetStates()
  );
};
