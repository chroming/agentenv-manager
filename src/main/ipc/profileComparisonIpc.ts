import type { EvaluationService } from "../evaluations/evaluationService";
import type {
  OneShotEvaluationPreviewInput,
  OneShotEvaluationStartInput
} from "../../shared/types";
import { parseId, type IpcRegistrationHandles } from "./registration";

export const registerProfileComparisonIpc = (
  handles: Pick<IpcRegistrationHandles, "diagnosticHandle">,
  evaluationService: EvaluationService
) => {
  const { diagnosticHandle } = handles;
  diagnosticHandle("profile-comparisons:preview", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Profile comparison requires a Profile and Agent");
    }
    const value = input as Partial<OneShotEvaluationPreviewInput>;
    let workspace: OneShotEvaluationPreviewInput["workspace"] = { kind: "empty" };
    if (value.workspace !== undefined) {
      if (!value.workspace || typeof value.workspace !== "object") {
        throw new Error("Comparison Workspace is invalid");
      }
      if (value.workspace.kind === "folder") {
        if (typeof value.workspace.path !== "string" || !value.workspace.path.trim()) {
          throw new Error("Comparison Workspace folder is required");
        }
        workspace = { kind: "folder", path: value.workspace.path };
      } else if (value.workspace.kind !== "empty") {
        throw new Error("Comparison Workspace type is invalid");
      }
    }
    return evaluationService.preview({
      profileId: parseId(value.profileId, "profile id"),
      targetId: parseId(value.targetId, "target id"),
      workspace,
      excludeMcp: value.excludeMcp === true
    });
  });
  diagnosticHandle("profile-comparisons:start", (_event, input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Profile comparison requires a reviewed Preview and task");
    }
    const value = input as Partial<OneShotEvaluationStartInput>;
    if (typeof value.prompt !== "string") throw new Error("Evaluation task is required");
    return evaluationService.start({
      previewId: String(value.previewId ?? ""),
      prompt: value.prompt
    });
  });
  diagnosticHandle("profile-comparisons:read", (_event, input: unknown) => {
    const value = input && typeof input === "object"
      ? input as { runId?: unknown }
      : undefined;
    return evaluationService.read({
      runId: typeof value?.runId === "string" ? value.runId : undefined
    });
  });
  diagnosticHandle("profile-comparisons:cancel", (_event, runId: unknown) =>
    evaluationService.cancel(String(runId ?? ""))
  );
};
