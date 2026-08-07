import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type {
  NativeInstructionSnapshot,
  NativeInstructionsInspection,
  NativeMcpConnection,
  NativeMcpInspection,
  NativeMcpInspectionIssue,
  NativeInstructionsInspectionIssue
} from "../../shared/types";

const emptyInstructionsInspection: NativeInstructionsInspection = {
  snapshots: [],
  issues: []
};

const inspectInstructions = () =>
  window.agentEnv.listNativeInstructions?.() ?? Promise.resolve(emptyInstructionsInspection);

export const useNativeResourceInspection = ({
  setError
}: {
  setError: Dispatch<SetStateAction<string | undefined>>;
}) => {
  const [nativeMcpConnections, setNativeMcpConnections] =
    useState<NativeMcpConnection[]>();
  const [nativeMcpIssues, setNativeMcpIssues] = useState<NativeMcpInspectionIssue[]>([]);
  const [nativeInstructionSnapshots, setNativeInstructionSnapshots] = useState<
    NativeInstructionSnapshot[]
  >([]);
  const [nativeInstructionIssues, setNativeInstructionIssues] = useState<
    NativeInstructionsInspectionIssue[]
  >([]);

  const refreshNativeResources = useCallback(async () => {
    try {
      const [mcpInspection, instructionInspection] = await Promise.all([
        window.agentEnv.listNativeMcpConnections(),
        inspectInstructions()
      ]);
      setNativeMcpConnections(mcpInspection.connections);
      setNativeMcpIssues(mcpInspection.issues);
      setNativeInstructionSnapshots(instructionInspection.snapshots);
      setNativeInstructionIssues(instructionInspection.issues);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  }, [setError]);

  const loadForProfileCore = useCallback((shouldApply: () => boolean = () => true) => {
    const nativeMcpPromise = window.agentEnv.listNativeMcpConnections();
    const nativeInstructionPromise = inspectInstructions();
    void nativeMcpPromise
      .then((inspection: NativeMcpInspection) => {
        if (shouldApply()) {
          setNativeMcpConnections(inspection.connections);
          setNativeMcpIssues(inspection.issues);
        }
      })
      .catch((unknownError) => {
        if (shouldApply()) {
          setNativeMcpConnections(undefined);
          setNativeMcpIssues([]);
          console.warn(
            `[AgentEnv] Native MCP diagnostics are unavailable: ${
              unknownError instanceof Error ? unknownError.message : String(unknownError)
            }`
          );
        }
      });
    void nativeInstructionPromise
      .then((inspection) => {
        if (shouldApply()) {
          setNativeInstructionSnapshots(inspection.snapshots);
          setNativeInstructionIssues(inspection.issues);
        }
      })
      .catch((unknownError) => {
        if (shouldApply()) {
          setNativeInstructionSnapshots([]);
          setNativeInstructionIssues([]);
          console.warn(
            `[AgentEnv] Native instruction diagnostics are unavailable: ${
              unknownError instanceof Error ? unknownError.message : String(unknownError)
            }`
          );
        }
      });
  }, []);

  return {
    nativeMcpConnections,
    nativeMcpIssues,
    nativeInstructionSnapshots,
    nativeInstructionIssues,
    setNativeMcpConnections,
    setNativeMcpIssues,
    refreshNativeResources,
    loadForProfileCore
  };
};
