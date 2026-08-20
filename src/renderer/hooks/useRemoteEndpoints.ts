import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  CreateRemoteDeviceInput,
  RemoteAgentEndpoint,
  RemoteDevice,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState,
  UpdateRemoteDeviceInput
} from "../../shared/types";

const endpointTargetInfo = (
  endpoint: RemoteAgentEndpoint,
  descriptor: TargetDescriptor
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
    configDir: endpoint.homeDir,
    instructionsPath: endpoint.homeDir,
    configPath: endpoint.homeDir
  },
  health: {
    status: "ready",
    installationFound: true,
    installationEvidence: [{
      kind: "command",
      label: `SSH · ${endpoint.deviceName}`,
      path: endpoint.executablePath
    }],
    executableName: descriptor.executableName,
    executableCandidates: descriptor.executableCandidates,
    executableStatus: "found",
    executablePath: endpoint.executablePath,
    executableSource: "path",
    executableFound: true,
    canWrite: true,
    summary: `Ready on ${endpoint.deviceName}`,
    checks: []
  },
  conversationCapabilities: {
    history: { state: "unsupported", evidence: ["Remote history is not read"] },
    openOriginal: { state: "unsupported", evidence: ["Remote launch is not supported"] },
    continue: { state: "unsupported", evidence: ["Remote continuation is not supported"] }
  }
});

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
  const [busy, setBusy] = useState(false);
  const profileTargets = useMemo(() => [
    ...targets,
    ...endpoints.flatMap((endpoint) => {
      const descriptor = supportedTargets.find((target) => target.id === endpoint.agentId);
      return descriptor ? [endpointTargetInfo(endpoint, descriptor)] : [];
    })
  ], [endpoints, supportedTargets, targets]);
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
      const states = await (window.agentEnv.listRemoteTargetStates?.() ?? Promise.resolve([]));
      setDevices(nextDevices);
      setEndpoints(nextEndpoints);
      setTargetStates((current) => [
        ...current.filter((state) => !state.targetId.startsWith("ssh:")),
        ...states
      ]);
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

  const runMutation = async (mutation: () => Promise<unknown>, forceRefresh: boolean) => {
    setBusy(true);
    try {
      await mutation();
      await load(forceRefresh);
    } finally {
      setBusy(false);
    }
  };

  return {
    devices,
    endpoints,
    profileTargets,
    targetNames,
    busy,
    refresh,
    add: (input: CreateRemoteDeviceInput) => {
      if (!window.agentEnv.addRemoteDevice) return Promise.resolve();
      return runMutation(() => window.agentEnv.addRemoteDevice!(input), true);
    },
    update: (input: UpdateRemoteDeviceInput) => {
      if (!window.agentEnv.updateRemoteDevice) return Promise.resolve();
      return runMutation(() => window.agentEnv.updateRemoteDevice!(input), true);
    },
    remove: (id: string) => {
      if (!window.agentEnv.removeRemoteDevice) return Promise.resolve();
      return runMutation(() => window.agentEnv.removeRemoteDevice!(id), false);
    }
  };
};
