import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  CreateRemoteDeviceInput,
  RemoteAgentEndpoint,
  RemoteDevice,
  RemoteDeviceProbe,
  SshConfigHost,
  SshConfigHostResolution,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState,
  UpdateRemoteDeviceInput
} from "../../shared/types";
import { mergeRemoteTargetStates } from "../targetStateSlices";

const endpointTargetInfo = (
  endpoint: RemoteAgentEndpoint,
  descriptor: TargetDescriptor,
  device?: RemoteDevice
): TargetInfo => ({
  ...descriptor,
  id: endpoint.id,
  name: `${descriptor.name} · ${endpoint.deviceName}`,
  description: `SSH Linux · ${endpoint.deviceName}`,
  capabilities: {
    ...descriptor.capabilities,
    evaluation: false,
    evaluationUnavailableReason: "Profile comparison is not available over SSH"
  },
  paths: {
    targetId: endpoint.id,
    configDir: endpoint.homeDir ?? "",
    instructionsPath: endpoint.homeDir ?? "",
    configPath: endpoint.homeDir ?? ""
  },
  health: {
    status: endpoint.availability === "ready" ? "ready" : "unknown",
    installationFound: true,
    installationEvidence: endpoint.executablePath ? [{
      kind: "command" as const,
      label: `SSH · ${endpoint.deviceName}`,
      path: endpoint.executablePath
    }] : [],
    executableName: descriptor.executableName,
    executableCandidates: descriptor.executableCandidates,
    executableStatus: endpoint.availability === "ready" ? "found" : "unknown",
    executablePath: endpoint.executablePath,
    executableSource: "path",
    executableFound: endpoint.availability === "ready",
    canWrite: endpoint.availability === "ready",
    summary: endpoint.availability === "ready"
      ? `Ready on ${endpoint.deviceName}`
      : endpoint.availabilityReason ?? `Unavailable on ${endpoint.deviceName}`,
    checks: []
  },
  conversationCapabilities: {
    history: { state: "unsupported", evidence: ["Remote history is not read"] },
    openOriginal: { state: "unsupported", evidence: ["Remote launch is not supported"] },
    continue: { state: "unsupported", evidence: ["Remote continuation is not supported"] }
  },
  location: {
    kind: "ssh",
    deviceId: endpoint.deviceId,
    deviceName: endpoint.deviceName,
    agentName: descriptor.name,
    host: device?.host
  }
});

const mergeLastKnownEndpoints = (
  current: RemoteAgentEndpoint[],
  next: RemoteAgentEndpoint[],
  probes: RemoteDeviceProbe[]
) => {
  const merged = new Map(next.map((endpoint) => [endpoint.id, endpoint]));
  const probesByDevice = new Map(probes.map((probe) => [probe.deviceId, probe]));
  for (const endpoint of current) {
    if (merged.has(endpoint.id)) continue;
    const probe = probesByDevice.get(endpoint.deviceId);
    if (!probe) {
      merged.set(endpoint.id, endpoint);
      continue;
    }
    if (probe.status === "ready") continue;
    merged.set(endpoint.id, {
      ...endpoint,
      checkedAt: probe.checkedAt,
      availability: probe.status,
      availabilityReason: probe.error ?? "SSH device is unavailable"
    });
  }
  return [...merged.values()];
};

export const useRemoteEndpoints = ({
  targets,
  supportedTargets,
  setTargetStates,
  enabled,
  sharedSkillsLabel,
  onError
}: {
  targets: TargetInfo[];
  supportedTargets: TargetDescriptor[];
  setTargetStates: Dispatch<SetStateAction<TargetManagementState[]>>;
  enabled: boolean;
  sharedSkillsLabel: string;
  onError(message: string): void;
}) => {
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [endpoints, setEndpoints] = useState<RemoteAgentEndpoint[]>([]);
  const [probes, setProbes] = useState<RemoteDeviceProbe[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyDeviceIds, setBusyDeviceIds] = useState<string[]>([]);
  const devicesById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);
  const profileTargets = useMemo(() => [
    ...targets,
    ...endpoints.flatMap((endpoint) => {
      const descriptor = supportedTargets.find((target) => target.id === endpoint.agentId);
      return descriptor ? [endpointTargetInfo(endpoint, descriptor, devicesById.get(endpoint.deviceId))] : [];
    })
  ], [devicesById, endpoints, supportedTargets, targets]);
  const targetNames = useMemo(() => ({
    ...Object.fromEntries(supportedTargets.map((target) => [target.id, target.name])),
    ...Object.fromEntries(endpoints.map((endpoint) => [
      endpoint.id,
      `${endpoint.agentName} · ${endpoint.deviceName}`
    ])),
    "shared-compatibility": sharedSkillsLabel
  }), [endpoints, sharedSkillsLabel, supportedTargets]);

  const load = useCallback(async (forceRefresh = false) => {
    if (!window.agentEnv.listRemoteDevices || !window.agentEnv.listRemoteEndpoints) return;
    setBusy(true);
    try {
      const nextDevices = await window.agentEnv.listRemoteDevices();
      const nextEndpoints = await window.agentEnv.listRemoteEndpoints(forceRefresh);
      const nextProbes = window.agentEnv.probeRemoteDevice
        ? await Promise.all(nextDevices.map((device) =>
            window.agentEnv.probeRemoteDevice!(device.id, false)
          ))
        : [];
      const states = await (window.agentEnv.listRemoteTargetStates?.() ?? Promise.resolve([]));
      setDevices(nextDevices);
      setEndpoints((current) => mergeLastKnownEndpoints(current, nextEndpoints, nextProbes));
      setProbes(nextProbes);
      setTargetStates((current) => mergeRemoteTargetStates(current, states));
    } finally {
      setBusy(false);
    }
  }, [setTargetStates]);

  const refresh = useCallback(async (forceRefresh = false) => {
    try {
      await load(forceRefresh);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }, [load, onError]);

  useEffect(() => {
    if (!enabled) return;
    void refresh(false);
  }, [enabled, refresh]);

  const runMutation = async <T,>(mutation: () => Promise<T>, forceRefresh: boolean): Promise<T> => {
    setBusy(true);
    try {
      const result = await mutation();
      await load(forceRefresh);
      return result;
    } finally {
      setBusy(false);
    }
  };

  const refreshDevice = useCallback(async (deviceId: string) => {
    if (!window.agentEnv.probeRemoteDevice || !window.agentEnv.listRemoteEndpoints) return;
    setBusyDeviceIds((current) => current.includes(deviceId) ? current : [...current, deviceId]);
    try {
      const probe = await window.agentEnv.probeRemoteDevice(deviceId, true);
      const [nextEndpoints, states] = await Promise.all([
        window.agentEnv.listRemoteEndpoints(false),
        window.agentEnv.listRemoteTargetStates?.() ?? Promise.resolve([])
      ]);
      setProbes((current) => [
        ...current.filter((item) => item.deviceId !== deviceId),
        probe
      ]);
      setEndpoints((current) => mergeLastKnownEndpoints(current, nextEndpoints, [probe]));
      setTargetStates((current) => mergeRemoteTargetStates(current, states));
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyDeviceIds((current) => current.filter((id) => id !== deviceId));
    }
  }, [onError, setTargetStates]);

  return {
    devices,
    endpoints,
    probes,
    profileTargets,
    targetNames,
    busy,
    busyDeviceIds,
    refresh,
    refreshDevice,
    listSshConfigHosts: (): Promise<SshConfigHost[]> =>
      window.agentEnv.listSshConfigHosts?.() ?? Promise.resolve([]),
    resolveSshConfigHost: (alias: string): Promise<SshConfigHostResolution> => {
      if (!window.agentEnv.resolveSshConfigHost) {
        return Promise.reject(new Error("SSH config discovery is unavailable"));
      }
      return window.agentEnv.resolveSshConfigHost(alias);
    },
    add: (input: CreateRemoteDeviceInput) => {
      if (!window.agentEnv.addRemoteDevice) return Promise.resolve();
      return runMutation(async () => {
        const device = await window.agentEnv.addRemoteDevice!(input);
        const probe = await window.agentEnv.probeRemoteDevice?.(device.id, false);
        return { device, probe };
      }, false);
    },
    update: (input: UpdateRemoteDeviceInput) => {
      if (!window.agentEnv.updateRemoteDevice) return Promise.resolve();
      return runMutation(async () => {
        const device = await window.agentEnv.updateRemoteDevice!(input);
        const probe = await window.agentEnv.probeRemoteDevice?.(device.id, false);
        return { device, probe };
      }, false);
    },
    remove: (id: string) => {
      if (!window.agentEnv.removeRemoteDevice) return Promise.resolve();
      return runMutation(() => window.agentEnv.removeRemoteDevice!(id), false);
    }
  };
};
