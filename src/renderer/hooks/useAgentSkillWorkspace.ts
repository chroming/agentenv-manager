import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  ActivationPreview,
  BackupSummary,
  LibraryResourceVersions,
  ProfileDetail,
  ProfileResourceMode,
  ProfileResources,
  ProfileSummary,
  SkillInventoryEntry,
  SkillLibraryEntry,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { collectLibraryResourceVersions } from "../../shared/libraryVersions";
import {
  compareProfilesByCreationTime,
  reconcileProfileUsage,
  summarizeProfile,
  type ProfileResourceSummary
} from "../profileSummary";
import { acceptAppliedProfileState } from "../appliedProfileState";

type ProfileEditStrategy = "fork" | "shared";

interface UseAgentSkillWorkspaceOptions {
  targets: TargetInfo[];
  targetStates: TargetManagementState[];
  profiles: ProfileSummary[];
  librarySkills: SkillLibraryEntry[];
  skillInventory: SkillInventoryEntry[];
  draftProfile?: ProfileDetail;
  isProfileDirty: boolean;
  setProfiles: Dispatch<SetStateAction<ProfileSummary[]>>;
  setTargetStates: Dispatch<SetStateAction<TargetManagementState[]>>;
  setProfileResourceCounts: Dispatch<
    SetStateAction<Record<string, ProfileResourceSummary>>
  >;
  setProfileLibraryVersions: Dispatch<
    SetStateAction<Record<string, LibraryResourceVersions>>
  >;
  setSkillInventory: Dispatch<SetStateAction<SkillInventoryEntry[]>>;
  setSkillUsage: Dispatch<SetStateAction<Record<string, string[]>>>;
  setDraftProfile: Dispatch<SetStateAction<ProfileDetail | undefined>>;
  setBackups: Dispatch<SetStateAction<BackupSummary[]>>;
  setSelectedTargetId: Dispatch<SetStateAction<string | undefined>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  openTargetsWorkspace(): void;
}

const profileSummaryOf = (profile: ProfileDetail): ProfileSummary => ({
  id: profile.id,
  preferredTargetId: profile.manifest.preferredTargetId,
  createdFromTargetId: profile.manifest.createdFromTargetId,
  name: profile.manifest.name,
  description: profile.manifest.description,
  createdAt: profile.manifest.createdAt,
  iconKey: profile.manifest.iconKey,
  contentHash: profile.contentHash,
  targetContentHashes: profile.targetContentHashes
});

export const useAgentSkillWorkspace = ({
  targets,
  targetStates,
  profiles,
  librarySkills,
  skillInventory,
  draftProfile,
  isProfileDirty,
  setProfiles,
  setTargetStates,
  setProfileResourceCounts,
  setProfileLibraryVersions,
  setSkillInventory,
  setSkillUsage,
  setDraftProfile,
  setBackups,
  setSelectedTargetId,
  setError,
  openTargetsWorkspace
}: UseAgentSkillWorkspaceOptions) => {
  const [selectedTargetId, setWorkspaceTargetId] = useState<string>();
  const [profile, setProfile] = useState<ProfileDetail>();
  const [profileByTarget, setProfileByTarget] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [preview, setPreview] = useState<ActivationPreview>();
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [importReturnTargetId, setImportReturnTargetId] = useState<string>();
  const [importedSkillIds, setImportedSkillIds] = useState<string[]>([]);
  const requestRef = useRef(0);

  useEffect(() => {
    if (saveStatus !== "Skill changes saved") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setSaveStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [saveStatus]);

  const close = () => {
    requestRef.current += 1;
    setWorkspaceTargetId(undefined);
    setProfile(undefined);
    setLoadError("");
    setPreview(undefined);
    setSaveStatus("");
    setImportReturnTargetId(undefined);
    setImportedSkillIds([]);
  };

  const open = async (targetId: string, explicitProfileId?: string) => {
    const requestId = ++requestRef.current;
    const targetState = targetStates.find((state) => state.targetId === targetId);
    const rememberedProfileId = profileByTarget[targetId];
    const capturedProfileId = profiles.find(
      (candidate) =>
        !candidate.loadError &&
        candidate.createdFromTargetId === targetId
    )?.id;
    const profileId =
      explicitProfileId ??
      targetState?.activeProfileId ??
      (rememberedProfileId && profiles.some(
        (candidate) =>
          candidate.id === rememberedProfileId && !candidate.loadError
      )
        ? rememberedProfileId
        : undefined) ??
      capturedProfileId;

    setWorkspaceTargetId(targetId);
    setSelectedTargetId(targetId);
    setPreview(undefined);
    setSaveStatus("");
    setLoadError("");
    openTargetsWorkspace();
    if (!profileId) {
      setProfile(undefined);
      setLoading(false);
      return;
    }

    setProfile(undefined);
    setLoading(true);
    try {
      const loaded = await window.agentEnv.readProfile(profileId);
      if (requestId !== requestRef.current) return;
      setProfile(loaded);
      setProfileByTarget((current) => ({
        ...current,
        [targetId]: loaded.id
      }));
    } catch (unknownError) {
      if (requestId !== requestRef.current) return;
      setProfile(undefined);
      setLoadError(
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      );
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
      }
    }
  };

  const acceptProfile = (
    saved: ProfileDetail,
    previous: ProfileDetail,
    forked: boolean,
    changed: boolean
  ) => {
    const summary = profileSummaryOf(saved);
    setProfiles((current) => {
      const next = current.some((candidate) => candidate.id === saved.id)
        ? current.map((candidate) => candidate.id === saved.id ? summary : candidate)
        : current.concat(summary);
      return [...next].sort(compareProfilesByCreationTime);
    });
    const target = targets.find((candidate) => candidate.id === selectedTargetId);
    if (target) {
      setProfileResourceCounts((current) => ({
        ...current,
        [saved.id]: summarizeProfile(saved, target, librarySkills)
      }));
    }
    setProfileLibraryVersions((current) => ({
      ...current,
      [saved.id]: collectLibraryResourceVersions(
        saved,
        librarySkills,
        target?.id
      )
    }));
    setSkillUsage((current) => {
      if (!forked) {
        return reconcileProfileUsage(
          current,
          previous.resources.skills.map((skill) => skill.libraryId),
          saved.resources.skills.map((skill) => skill.libraryId),
          previous.manifest.name,
          saved.manifest.name
        );
      }
      const next = Object.fromEntries(
        Object.entries(current).map(([id, names]) => [id, [...names]])
      );
      for (const skill of saved.resources.skills) {
        const names = next[skill.libraryId] ?? [];
        if (!names.includes(saved.manifest.name)) {
          next[skill.libraryId] = [...names, saved.manifest.name];
        }
      }
      return next;
    });
    if (!forked && changed) {
      setTargetStates((current) =>
        current.map((state) =>
          state.activeProfileId === saved.id &&
          state.lifecycleStatus !== "drifted" &&
          state.lifecycleStatus !== "recovery-required"
            ? {
                ...state,
                lifecycleStatus: "pending" as const,
                lifecycleReason: "Saved Profile changed after the last Apply"
              }
            : state
        )
      );
    }
    setProfile(saved);
    setLoadError("");
    if (selectedTargetId) {
      setProfileByTarget((current) => ({
        ...current,
        [selectedTargetId]: saved.id
      }));
    }
    if (!isProfileDirty && draftProfile?.id === saved.id) {
      setDraftProfile(saved);
    }
  };

  const saveProfileSkills = async (
    resources: ProfileResources,
    strategy: ProfileEditStrategy,
    managementMode?: ProfileResourceMode
  ) => {
    const targetId = selectedTargetId;
    const currentProfile = profile;
    if (
      !targetId ||
      !currentProfile ||
      !currentProfile.contentHash ||
      saving
    ) {
      return;
    }
    setSaving(true);
    setSaveStatus("Saving changes...");
    setError(undefined);
    setPreview(undefined);
    try {
      const result = strategy === "fork"
        ? await window.agentEnv.forkProfileSkills({
            profileId: currentProfile.id,
            targetId,
            expectedContentHash: currentProfile.contentHash,
            name: `${currentProfile.manifest.name} (${targets.find(
              (target) => target.id === targetId
            )?.name ?? targetId})`,
            skills: resources.skills,
            managementMode: managementMode ?? "manage"
          })
        : await window.agentEnv.updateProfileSkills({
            profileId: currentProfile.id,
            targetId,
            expectedContentHash: currentProfile.contentHash,
            skills: resources.skills,
            managementMode
          });
      acceptProfile(
        result.profile,
        currentProfile,
        strategy === "fork",
        result.changed
      );
      setSaveStatus(result.changed ? "Skill changes saved" : "No Skill changes");
    } catch (unknownError) {
      const message = unknownError instanceof Error
        ? unknownError.message
        : String(unknownError);
      setSaveStatus("Skill changes could not be saved");
      setError(message);
      void open(targetId, currentProfile.id);
    } finally {
      setSaving(false);
    }
  };

  const acceptAppliedProfile = (
    appliedProfile: ProfileDetail,
    appliedPreview: ActivationPreview
  ) => {
    acceptAppliedProfileState({
      profile: appliedProfile,
      preview: appliedPreview,
      setTargetStates,
      setBackups,
      setSkillInventory
    });
  };

  const previewApply = async () => {
    const currentProfile = profile;
    const targetId = selectedTargetId;
    if (!currentProfile || !targetId || previewing || saving) return;
    setPreviewing(true);
    setSaveStatus("");
    setError(undefined);
    try {
      setPreview(await window.agentEnv.previewApply(currentProfile.id, targetId));
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setPreviewing(false);
    }
  };

  const apply = async () => {
    const currentProfile = profile;
    const currentPreview = preview;
    if (!currentProfile || !currentPreview || applying) return;
    setApplying(true);
    setError(undefined);
    try {
      const result = await window.agentEnv.applyProfile(
        currentProfile.id,
        currentPreview.id
      );
      if (!result.ok) {
        if (result.kind === "stale") {
          setSaveStatus(
            "The Agent changed while Preview was open. Preview refreshed."
          );
          setPreview(
            await window.agentEnv.previewApply(
              currentProfile.id,
              currentPreview.targetId
            )
          );
          return;
        }
        if (result.kind === "busy") {
          setSaveStatus(
            "Another AgentEnv operation is still running. Try Apply again shortly."
          );
          return;
        }
        if (result.kind === "no-op") {
          setPreview(undefined);
          setSaveStatus("This Agent already matches the Profile.");
          return;
        }
        setError(result.errors.join("\n"));
        return;
      }
      acceptAppliedProfile(currentProfile, currentPreview);
      setPreview(undefined);
      setSaveStatus("Profile applied");
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    } finally {
      setApplying(false);
    }
  };

  const acceptCapturedProfile = (targetId: string, saved: ProfileDetail) => {
    setWorkspaceTargetId(targetId);
    setProfile(saved);
    setLoadError("");
    setProfileByTarget((current) => ({
      ...current,
      [targetId]: saved.id
    }));
  };

  const beginImport = () => {
    if (!selectedTargetId) return;
    setImportReturnTargetId(selectedTargetId);
    setImportedSkillIds([]);
  };

  const rememberImportedSkills = (skills: SkillLibraryEntry[]) => {
    if (!importReturnTargetId || skills.length === 0) return;
    setImportedSkillIds((current) => [
      ...new Set([...current, ...skills.map((skill) => skill.id)])
    ]);
  };

  const selectedTarget = targets.find(
    (target) => target.id === selectedTargetId
  );
  const targetState = targetStates.find(
    (state) => state.targetId === selectedTargetId
  );
  const sharedProfileTargetNames = profile
    ? targetStates
        .filter((state) => state.activeProfileId === profile.id)
        .map(
          (state) =>
            targets.find((target) => target.id === state.targetId)?.name ??
            state.targetId
        )
    : [];
  const localSkillCount = selectedTargetId
    ? new Set(
        skillInventory
          .filter(
            (skill) =>
              skill.foundIn.includes(selectedTargetId) ||
              skill.runtimeStates?.some(
                (state) => state.targetId === selectedTargetId
              )
          )
          .map((skill) => skill.skillKey)
      ).size
    : 0;
  const importedSkills = librarySkills.filter((skill) =>
    importedSkillIds.includes(skill.id)
  );

  return {
    selectedTargetId,
    selectedTarget,
    targetState,
    profile,
    profileByTarget,
    sharedProfileTargetNames,
    localSkillCount,
    importedSkills,
    loading,
    loadError,
    saving,
    saveStatus,
    preview,
    previewing,
    applying,
    importReturnTargetId,
    open,
    close,
    retry: () => selectedTargetId ? open(selectedTargetId) : Promise.resolve(),
    saveProfileSkills,
    previewApply,
    cancelPreview: () => setPreview(undefined),
    apply,
    acceptCapturedProfile,
    beginImport,
    clearImportReturn: () => setImportReturnTargetId(undefined),
    clearImportedSkills: () => setImportedSkillIds([]),
    rememberImportedSkills
  };
};

export type AgentSkillWorkspaceController = ReturnType<
  typeof useAgentSkillWorkspace
>;
