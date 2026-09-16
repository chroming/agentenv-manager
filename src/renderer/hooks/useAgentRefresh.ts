import { useRef, type Dispatch, type SetStateAction } from "react";
import type {
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  ProfileSummary,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import type { useFreshnessCoordinator } from "./useFreshnessCoordinator";
import { orderByPreference } from "../../shared/uiState";
import { mergeLocalTargetStates, preserveSelectedTarget } from "../targetStateSlices";

type FreshnessRunner = ReturnType<typeof useFreshnessCoordinator>["run"];
type AgentRefreshReason = "page-entry" | "focus" | "mutation" | "manual";

export const useAgentRefresh = ({
  loadRecoveryHistory,
  agentOrder,
  profiles,
  runFreshness,
  setError,
  setDiscoveredTargets,
  setMcpConnections,
  setMcpIssues,
  setSelectedTargetId,
  setSupportedTargets,
  setTargetStates,
  setTargets
}: {
  loadRecoveryHistory(): Promise<unknown>;
  agentOrder: string[];
  profiles: ProfileSummary[];
  runFreshness: FreshnessRunner;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setDiscoveredTargets: Dispatch<SetStateAction<TargetInfo[]>>;
  setMcpConnections: Dispatch<SetStateAction<NativeMcpConnection[] | undefined>>;
  setMcpIssues: Dispatch<SetStateAction<NativeMcpInspectionIssue[]>>;
  setSelectedTargetId: Dispatch<SetStateAction<string | undefined>>;
  setSupportedTargets: Dispatch<SetStateAction<TargetDescriptor[]>>;
  setTargetStates: Dispatch<SetStateAction<TargetManagementState[]>>;
  setTargets: Dispatch<SetStateAction<TargetInfo[]>>;
}) => {
  const currentOrder = useRef(agentOrder);
  const currentProfiles = useRef(profiles);
  currentOrder.current = agentOrder;
  currentProfiles.current = profiles;
  return async (reason: AgentRefreshReason = "manual") => {
    const announce = reason === "manual";
    if (announce) {
      setError(undefined);
    }
    try {
      await runFreshness("agents", reason, async () => {
        const [
          supportedTargets,
          targets,
          targetStates,
          nativeMcpResult,
          discoveredTargets
        ] = await Promise.all([
          window.agentEnv.listSupportedTargets(),
          window.agentEnv.listTargets(true),
          window.agentEnv.listTargetStates(),
          window.agentEnv.listNativeMcpConnections()
            .then((value) => ({ error: undefined, value }))
            .catch((error: unknown) => ({
              error: error instanceof Error ? error.message : String(error),
              value: undefined
            })),
          window.agentEnv.probeSupportedTargets(true)
        ]);
        const orderedSupportedTargets = orderByPreference(
          supportedTargets,
          currentOrder.current,
          (target) => target.id
        );
        const orderedTargets = orderByPreference(targets, currentOrder.current, (target) => target.id);
        const orderedDiscoveredTargets = orderByPreference(
          discoveredTargets,
          currentOrder.current,
          (target) => target.id
        );
        setSupportedTargets(orderedSupportedTargets);
        setTargets(orderedTargets);
        setDiscoveredTargets(orderedDiscoveredTargets);
        if (nativeMcpResult.value) {
          setMcpConnections(nativeMcpResult.value.connections);
          setMcpIssues(nativeMcpResult.value.issues);
        }
        setTargetStates((current) => mergeLocalTargetStates(
          current,
          targetStates.map((state) => ({
            ...state,
            activeProfileName:
              currentProfiles.current.find((profile) => profile.id === state.activeProfileId)?.name ??
              state.activeProfileName
          }))
        ));
        setSelectedTargetId((current) => preserveSelectedTarget(current, orderedTargets));
        // Recovery history is not required to display fresh Agent state.
        void loadRecoveryHistory().catch(() => undefined);
        return { mcpError: nativeMcpResult.error, targets: orderedTargets };
      }, {
        partialError: (value) => (
          value as { mcpError?: string }
        ).mcpError
      });
    } catch (unknownError) {
      if (announce) {
        setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      }
    }
  };
};
