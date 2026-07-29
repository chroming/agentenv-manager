import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  LibraryResourceVersions,
  ProfileDetail,
  ProfileSummary,
  ResourceIconKey,
  SaveProfileInput,
  SkillLibraryEntry,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { collectLibraryResourceVersions } from "../../shared/libraryVersions";
import { reconcileProfileUsage } from "../profileSummary";

const toSaveInput = (profile: ProfileDetail): SaveProfileInput => ({
  manifest: profile.manifest,
  instructions: profile.instructions,
  resources: profile.resources
});

interface SelectProfileOptions {
  onBeforeLoad?(isDifferentProfile: boolean): void;
  onLoaded?(profile: ProfileDetail): void;
}

interface UseProfileDraftControllerOptions {
  profiles: ProfileSummary[];
  targets: TargetInfo[];
  librarySkills: SkillLibraryEntry[];
  profileLibraryVersions: Record<string, LibraryResourceVersions>;
  setProfiles: Dispatch<SetStateAction<ProfileSummary[]>>;
  setProfileLibraryVersions: Dispatch<
    SetStateAction<Record<string, LibraryResourceVersions>>
  >;
  setSkillUsage: Dispatch<SetStateAction<Record<string, string[]>>>;
  setTargetStates: Dispatch<SetStateAction<TargetManagementState[]>>;
  onBusyChange(busy: boolean): void;
  onError(error: string | undefined): void;
  onDraftInvalidated(): void;
}

export const useProfileDraftController = ({
  profiles,
  targets,
  librarySkills,
  profileLibraryVersions,
  setProfiles,
  setProfileLibraryVersions,
  setSkillUsage,
  setTargetStates,
  onBusyChange,
  onError,
  onDraftInvalidated
}: UseProfileDraftControllerOptions) => {
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [profileLoadingId, setProfileLoadingId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");
  const flowRequestRef = useRef(0);
  const saveInFlightRef = useRef(false);

  useEffect(() => {
    if (status !== "Profile saved" && status !== "Profile details saved") {
      return undefined;
    }
    const timeout = window.setTimeout(() => setStatus(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const invalidateFlow = useCallback(() => {
    flowRequestRef.current += 1;
  }, []);

  const beginFlow = useCallback(() => {
    const requestId = ++flowRequestRef.current;
    return requestId;
  }, []);

  const isFlowCurrent = useCallback(
    (requestId: number) => requestId === flowRequestRef.current,
    []
  );

  const acceptProfile = useCallback((profile: ProfileDetail) => {
    setSelectedProfileId(profile.id);
    setDraftProfile(profile);
    setIsDirty(false);
    setStatus("");
  }, []);

  const replaceSavedProfile = useCallback((
    profile: ProfileDetail,
    nextStatus = ""
  ) => {
    setSelectedProfileId(profile.id);
    setDraftProfile(profile);
    setIsDirty(false);
    setStatus(nextStatus);
  }, []);

  const clearProfile = useCallback(() => {
    invalidateFlow();
    setSelectedProfileId(undefined);
    setProfileLoadingId(undefined);
    setDraftProfile(undefined);
    setIsDirty(false);
    setStatus("");
  }, [invalidateFlow]);

  const updateDraft = useCallback((profile: ProfileDetail) => {
    invalidateFlow();
    setDraftProfile(profile);
    setIsDirty(true);
    setStatus("");
    onDraftInvalidated();
  }, [invalidateFlow, onDraftInvalidated]);

  const discardDraft = useCallback(async () => {
    if (draftProfile) {
      try {
        acceptProfile(await window.agentEnv.readProfile(draftProfile.id));
      } catch {
        clearProfile();
      }
    } else {
      setIsDirty(false);
      setStatus("");
    }
    onDraftInvalidated();
  }, [acceptProfile, clearProfile, draftProfile, onDraftInvalidated]);

  const selectProfile = useCallback(async (
    profileId: string,
    options: SelectProfileOptions = {}
  ) => {
    const requestId = beginFlow();
    const isDifferentProfile = profileId !== selectedProfileId;
    onBusyChange(true);
    onError(undefined);
    options.onBeforeLoad?.(isDifferentProfile);
    if (isDifferentProfile) {
      setProfileLoadingId(profileId);
      setStatus("");
    }
    try {
      const profile = await window.agentEnv.readProfile(profileId);
      if (!isFlowCurrent(requestId)) {
        return undefined;
      }
      options.onLoaded?.(profile);
      acceptProfile(profile);
      return profile;
    } catch (unknownError) {
      if (isFlowCurrent(requestId)) {
        onError(
          unknownError instanceof Error ? unknownError.message : String(unknownError)
        );
      }
      return undefined;
    } finally {
      if (isFlowCurrent(requestId)) {
        setProfileLoadingId(undefined);
        onBusyChange(false);
      }
    }
  }, [
    acceptProfile,
    beginFlow,
    isFlowCurrent,
    onBusyChange,
    onError,
    selectedProfileId
  ]);

  const saveDraft = useCallback(async () => {
    if (!draftProfile) {
      return undefined;
    }

    const previousName =
      profiles.find((profile) => profile.id === draftProfile.id)?.name ??
      draftProfile.manifest.name;
    const previousLibraryVersions = profileLibraryVersions[draftProfile.id];
    setIsSaving(true);
    setStatus("Saving profile");
    try {
      const saved = await window.agentEnv.saveProfile(toSaveInput(draftProfile));
      const summary: ProfileSummary = {
        id: saved.id,
        preferredTargetId: saved.manifest.preferredTargetId,
        createdFromTargetId: saved.manifest.createdFromTargetId,
        name: saved.manifest.name,
        description: saved.manifest.description,
        createdAt: saved.manifest.createdAt,
        iconKey: saved.manifest.iconKey,
        contentHash: saved.contentHash,
        targetContentHashes: saved.targetContentHashes
      };
      setProfiles((current) =>
        current.some((profile) => profile.id === saved.id)
          ? current.map((profile) => profile.id === saved.id ? summary : profile)
          : current.concat(summary)
      );
      const preferredTarget = targets.find(
        (target) => target.id === saved.manifest.preferredTargetId
      ) ?? targets[0];
      setProfileLibraryVersions((current) => ({
        ...current,
        [saved.id]: collectLibraryResourceVersions(
          saved,
          librarySkills,
          preferredTarget?.id
        )
      }));
      setSkillUsage((current) => reconcileProfileUsage(
        current,
        Object.keys(previousLibraryVersions?.skills ?? {}),
        saved.resources.skills.map((reference) => reference.libraryId),
        previousName,
        saved.manifest.name
      ));
      setTargetStates((current) =>
        current.map((targetState) => {
          if (targetState.activeProfileId !== saved.id) return targetState;
          const expectedHash = saved.targetContentHashes?.[targetState.targetId];
          const contentChanged =
            !expectedHash || expectedHash !== targetState.appliedProfileHash;
          return {
            ...targetState,
            activeProfileName: saved.manifest.name,
            ...(contentChanged &&
            targetState.lifecycleStatus !== "drifted" &&
            targetState.lifecycleStatus !== "recovery-required"
              ? {
                  lifecycleStatus: "pending" as const,
                  lifecycleReason: "Saved Profile changed after the last Apply"
                }
              : {})
          };
        })
      );
      setDraftProfile(saved);
      setIsDirty(false);
      setStatus("Profile saved");
      onDraftInvalidated();
      return saved;
    } catch (error) {
      setStatus("");
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [
    draftProfile,
    librarySkills,
    onDraftInvalidated,
    profileLibraryVersions,
    profiles,
    setProfileLibraryVersions,
    setProfiles,
    setSkillUsage,
    setTargetStates,
    targets
  ]);

  const saveSelectedProfile = useCallback(async () => {
    if (saveInFlightRef.current) {
      return;
    }
    saveInFlightRef.current = true;
    onError(undefined);
    try {
      await saveDraft();
    } catch (unknownError) {
      onError(
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      );
    } finally {
      saveInFlightRef.current = false;
    }
  }, [onError, saveDraft]);

  const acceptProfileMetadata = useCallback((
    saved: ProfileDetail,
    previousName: string
  ) => {
    const summary: ProfileSummary = {
      id: saved.id,
      preferredTargetId: saved.manifest.preferredTargetId,
      createdFromTargetId: saved.manifest.createdFromTargetId,
      name: saved.manifest.name,
      description: saved.manifest.description,
      createdAt: saved.manifest.createdAt,
      iconKey: saved.manifest.iconKey,
      contentHash: saved.contentHash,
      targetContentHashes: saved.targetContentHashes
    };
    setProfiles((current) =>
      current.map((profile) => profile.id === saved.id ? summary : profile)
    );
    const versions = profileLibraryVersions[saved.id];
    setSkillUsage((current) => reconcileProfileUsage(
      current,
      Object.keys(versions?.skills ?? {}),
      Object.keys(versions?.skills ?? {}),
      previousName,
      saved.manifest.name
    ));
    setTargetStates((current) =>
      current.map((targetState) =>
        targetState.activeProfileId === saved.id
          ? { ...targetState, activeProfileName: saved.manifest.name }
          : targetState
      )
    );
    setDraftProfile((current) =>
      current?.id === saved.id
        ? {
            ...current,
            manifest: {
              ...current.manifest,
              name: saved.manifest.name,
              description: saved.manifest.description,
              iconKey: saved.manifest.iconKey as ResourceIconKey | undefined
            },
            contentHash: saved.contentHash,
            targetContentHashes: saved.targetContentHashes
          }
        : current
    );
    setStatus("Profile details saved");
  }, [
    profileLibraryVersions,
    setProfiles,
    setSkillUsage,
    setTargetStates
  ]);

  return {
    acceptProfile,
    acceptProfileMetadata,
    beginFlow,
    clearProfile,
    discardDraft,
    draftProfile,
    invalidateFlow,
    isDirty,
    isFlowCurrent,
    isSaving,
    profileLoadingId,
    replaceSavedProfile,
    saveDraft,
    saveSelectedProfile,
    selectProfile,
    selectedProfileId,
    setStatus,
    status,
    updateDraft
  };
};
