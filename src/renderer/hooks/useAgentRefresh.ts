import type { Dispatch, SetStateAction } from "react";
import type {
  NativeMcpConnection,
  NativeMcpInspectionIssue,
  ProfileSummary,
  TargetDescriptor,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import type { useFreshnessCoordinator } from "./useFreshnessCoordinator";

type FreshnessRunner = ReturnType<typeof useFreshnessCoordinator>["run"];
type AgentRefreshReason = "page-entry" | "focus" | "mutation" | "manual";

export const useAgentRefresh = ({
  loadRecoveryHistory,
  profiles,
  runFreshness,
  setBusy,
  setError,
  setMcpConnections,
  setMcpIssues,
  setSelectedTargetId,
  setSupportedTargets,
  setTargetRefreshStatus,
  setTargetStates,
  setTargets
}: {
  loadRecoveryHistory(): Promise<unknown>;
  profiles: ProfileSummary[];
  runFreshness: FreshnessRunner;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setMcpConnections: Dispatch<SetStateAction<NativeMcpConnection[] | undefined>>;
  setMcpIssues: Dispatch<SetStateAction<NativeMcpInspectionIssue[]>>;
  setSelectedTargetId: Dispatch<SetStateAction<string | undefined>>;
  setSupportedTargets: Dispatch<SetStateAction<TargetDescriptor[]>>;
  setTargetRefreshStatus: Dispatch<
    SetStateAction<"refreshing" | "refreshed" | undefined>
  >;
  setTargetStates: Dispatch<SetStateAction<TargetManagementState[]>>;
  setTargets: Dispatch<SetStateAction<TargetInfo[]>>;
}) => async (reason: AgentRefreshReason = "manual") => {
  const announce = reason === "manual";
  if (announce) {
    setBusy(true);
    setError(undefined);
    setTargetRefreshStatus("refreshing");
  }
  try {
    await runFreshness("agents", reason, async () => {
      const [
        supportedTargets,
        targets,
        targetStates,
        nativeMcpResult
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
        loadRecoveryHistory()
      ]);
      setSupportedTargets(supportedTargets);
      setTargets(targets);
      if (nativeMcpResult.value) {
        setMcpConnections(nativeMcpResult.value.connections);
        setMcpIssues(nativeMcpResult.value.issues);
      }
      setTargetStates(targetStates.map((state) => ({
        ...state,
        activeProfileName:
          profiles.find((profile) => profile.id === state.activeProfileId)?.name ??
          state.activeProfileName
      })));
      setSelectedTargetId((current) =>
        current && targets.some((target) => target.id === current)
          ? current
          : targets[0]?.id
      );
      return { mcpError: nativeMcpResult.error, targets };
    }, {
      partialError: (value) => (
        value as { mcpError?: string }
      ).mcpError
    });
    if (announce) setTargetRefreshStatus("refreshed");
  } catch (unknownError) {
    if (announce) {
      setTargetRefreshStatus(undefined);
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  } finally {
    if (announce) setBusy(false);
  }
};
