import { useCallback, useRef, useState } from "react";
import type {
  ActivationPreview,
  ApplyIssue,
  ProfileDetail,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { activationPreviewHasWork } from "../activationPreview";

interface PreviewProfileInput {
  profile?: ProfileDetail;
  target?: TargetInfo;
  dirty: boolean;
  localValidationErrors: readonly string[];
  onSaveRequired(): void;
}

interface UseProfileActivationControllerOptions {
  onApplied(profile: ProfileDetail, preview: ActivationPreview): void;
  onBusyChange(busy: boolean): void;
  onError(error: string | undefined): void;
  onRollbackClear(): void;
  onStatus(message: string): void;
  onTargetsRefresh(targets: TargetInfo[]): void;
  onTargetStatesRefresh(states: TargetManagementState[]): void;
  translate(message: string): string;
}

export const useProfileActivationController = ({
  onApplied,
  onBusyChange,
  onError,
  onRollbackClear,
  onStatus,
  onTargetsRefresh,
  onTargetStatesRefresh,
  translate
}: UseProfileActivationControllerOptions) => {
  const [preview, setPreview] = useState<ActivationPreview>();
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [refreshDetail, setRefreshDetail] = useState<string>();
  const previewRequestRef = useRef(0);
  const previewBusyRef = useRef(false);

  const clearPreview = useCallback(() => {
    previewRequestRef.current += 1;
    if (previewBusyRef.current) {
      previewBusyRef.current = false;
      onBusyChange(false);
    }
    setPreview(undefined);
    setIsPreviewing(false);
  }, [onBusyChange]);

  const showPreview = useCallback((nextPreview: ActivationPreview) => {
    setPreview(nextPreview);
  }, []);

  const reset = useCallback(() => {
    clearPreview();
    setRefreshDetail(undefined);
  }, [clearPreview]);

  const refreshPreview = useCallback(async (
    profileId: string,
    targetId?: string
  ) => {
    const nextPreview = await window.agentEnv.previewApply(profileId, targetId);
    setPreview(nextPreview);
    return nextPreview;
  }, []);

  const previewProfile = useCallback(async ({
    profile,
    target,
    dirty,
    localValidationErrors,
    onSaveRequired
  }: PreviewProfileInput) => {
    onError(undefined);
    onRollbackClear();
    if (!profile) {
      return;
    }
    if (dirty) {
      onStatus("Save this environment before previewing changes");
      onSaveRequired();
      return;
    }

    const requestId = ++previewRequestRef.current;
    previewBusyRef.current = true;
    setIsPreviewing(true);
    onBusyChange(true);
    try {
      let currentTarget = target;
      if (target && !target.health.canWrite) {
        try {
          const refreshedTargets = await window.agentEnv.listTargets(true);
          onTargetsRefresh(refreshedTargets);
          currentTarget = refreshedTargets.find((candidate) => candidate.id === target.id) ?? target;
        } catch {
          // Keep the cached health evidence in the Preview when discovery cannot refresh.
        }
      }
      const nextPreview = await window.agentEnv.previewApply(profile.id, currentTarget?.id);
      if (requestId !== previewRequestRef.current) {
        return;
      }
      if (!activationPreviewHasWork(nextPreview)) {
        const refreshedStates = await window.agentEnv.listTargetStates();
        if (requestId !== previewRequestRef.current) {
          return;
        }
        onTargetStatesRefresh(refreshedStates);
      }
      const rendererBlockers: ApplyIssue[] = [
        ...(!currentTarget?.health.canWrite
          ? [{
              id: `target-unavailable:${currentTarget?.id ?? "unknown"}`,
              code: "target-unavailable" as const,
              disposition: "block" as const,
              resolution: "external-action" as const,
              resourceKind: "target" as const,
              resourceId: currentTarget?.id,
              message:
                currentTarget?.health.summary || `${currentTarget?.name ?? "Agent"} is unavailable`
            }]
          : []),
        ...localValidationErrors.map((message, index) => ({
          id: `profile-validation:${index}`,
          code: "profile-validation" as const,
          disposition: "block" as const,
          resolution: "edit-profile" as const,
          resourceKind: "profile" as const,
          message
        }))
      ];
      setPreview({
        ...nextPreview,
        issues: [...rendererBlockers, ...nextPreview.issues]
      });
    } catch (unknownError) {
      if (requestId === previewRequestRef.current) {
        onError(
          unknownError instanceof Error ? unknownError.message : String(unknownError)
        );
      }
    } finally {
      if (requestId === previewRequestRef.current) {
        previewBusyRef.current = false;
        setIsPreviewing(false);
        onBusyChange(false);
      }
    }
  }, [
    onBusyChange,
    onError,
    onRollbackClear,
    onStatus,
    onTargetsRefresh,
    onTargetStatesRefresh
  ]);

  const applyProfile = useCallback(async (profile?: ProfileDetail) => {
    if (!profile || !preview) {
      return;
    }

    onBusyChange(true);
    setIsApplying(true);
    onError(undefined);
    onStatus("");
    setRefreshDetail(undefined);
    try {
      const result = await window.agentEnv.applyProfile(profile.id, preview.id);
      if (!result.ok) {
        if (result.kind === "stale") {
          onStatus("The Agent changed while Preview was open. Preview refreshed.");
          setRefreshDetail(result.errors.join("\n") || undefined);
          setPreview(
            await window.agentEnv.previewApply(profile.id, preview.targetId)
          );
          return;
        }
        if (result.kind === "busy") {
          onStatus(
            "Another AgentEnv operation is still running. Try Apply again shortly."
          );
          return;
        }
        if (result.kind === "no-op") {
          setPreview(undefined);
          onStatus("This Agent already matches the Profile.");
          return;
        }
        onError(result.errors.join("\n"));
        return;
      }
      const reloadNotice = preview.issues.find(
        (issue) => issue.code === "runtime-reload-required"
      );
      onApplied(profile, preview);
      setPreview(undefined);
      onRollbackClear();
      if (reloadNotice) onStatus(translate(reloadNotice.message));
    } catch (unknownError) {
      onError(
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      );
    } finally {
      setIsApplying(false);
      onBusyChange(false);
    }
  }, [
    onApplied,
    onBusyChange,
    onError,
    onRollbackClear,
    onStatus,
    preview,
    translate
  ]);

  return {
    applyProfile,
    clearPreview,
    clearRefreshDetail: () => setRefreshDetail(undefined),
    isApplying,
    isPreviewing,
    preview,
    previewProfile,
    refreshDetail,
    refreshPreview,
    reset,
    showPreview
  };
};
