import type { Dispatch, SetStateAction } from "react";
import type {
  ActivationPreview,
  BackupSummary,
  ProfileDetail,
  SkillInventoryEntry,
  TargetManagementState
} from "../shared/types";

interface AcceptAppliedProfileStateOptions {
  profile: ProfileDetail;
  preview: ActivationPreview;
  setTargetStates: Dispatch<SetStateAction<TargetManagementState[]>>;
  setBackups: Dispatch<SetStateAction<BackupSummary[]>>;
  setSkillInventory: Dispatch<SetStateAction<SkillInventoryEntry[]>>;
}

export const acceptAppliedProfileState = ({
  profile,
  preview,
  setTargetStates,
  setBackups,
  setSkillInventory
}: AcceptAppliedProfileStateOptions) => {
  const appliedAt = new Date().toISOString();
  const appliedProfileHash = preview.profileContentHash;
  const appliedState: TargetManagementState = {
    targetId: preview.targetId,
    activeProfileId: profile.id,
    activeProfileName: profile.manifest.name,
    appliedProfileHash,
    appliedLibraryVersions: preview.libraryVersions,
    status: "managed",
    lifecycleStatus: (preview.skillReceipts ?? []).some(
      (receipt) => receipt.localOverride
    )
      ? "applied-with-local-override"
      : "applied",
    lastAppliedAt: appliedAt,
    managedResourceCount:
      preview.effectivePayload?.total ??
      preview.changes.length + preview.resourceChanges.length,
    skillReceipts: preview.skillReceipts ?? [],
    localOverrideCount: (preview.skillReceipts ?? []).filter(
      (receipt) => receipt.localOverride
    ).length,
    sharedSkillPreparations: preview.sharedSkillPreparations ?? [],
    warningCount: preview.issues.filter(
      (issue) => issue.disposition === "notice"
    ).length,
    errorCount: 0
  };

  setTargetStates((current) =>
    current.some((state) => state.targetId === preview.targetId)
      ? current.map((state) =>
          state.targetId === preview.targetId ? appliedState : state
        )
      : current.concat(appliedState)
  );

  void window.agentEnv.listBackups().then(setBackups).catch(() => undefined);
  void window.agentEnv
    .listTargetStates()
    .then((refreshedStates) => {
      setTargetStates((current) =>
        current.find((state) => state.targetId === preview.targetId)
          ?.appliedProfileHash === appliedProfileHash
          ? refreshedStates
          : current
      );
    })
    .catch(() => undefined);
  void window.agentEnv
    .scanSkillInventory()
    .then(setSkillInventory)
    .catch(() => undefined);
};
