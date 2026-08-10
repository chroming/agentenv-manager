import {
  useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction
} from "react";
import type {
  LibraryResourceVersions,
  ProfileDetail,
  ProfileSummary,
  ResourceIconKey,
  SkillLibraryEntry,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import {
  profileDraftsEqual,
  profileSaveInput
} from "../profileDraftState";
import { reconcileProfileUsage } from "../profileSummary";
import { publishSavedProfileState } from "./profileDraftPublication";

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
  setProfileLibraryVersions: Dispatch<SetStateAction<Record<string, LibraryResourceVersions>>>;
  setSkillUsage: Dispatch<SetStateAction<Record<string, string[]>>>;
  setTargetStates: Dispatch<SetStateAction<TargetManagementState[]>>;
  onBusyChange(busy: boolean): void;
  onError(error: string | undefined): void;
  onDraftInvalidated(): void;
  onSelectionChange?(profileId?: string): void;
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
  onDraftInvalidated,
  onSelectionChange
}: UseProfileDraftControllerOptions) => {
  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [profileLoadingId, setProfileLoadingId] = useState<string>();
  const [draftProfile, setDraftProfile] = useState<ProfileDetail>();
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");
  const flowRequestRef = useRef(0);
  const savePromiseRef = useRef<Promise<ProfileDetail | undefined> | undefined>(undefined);
  const autoSaveTimerRef = useRef<number | undefined>(undefined);
  const draftProfileRef = useRef<ProfileDetail | undefined>(undefined);
  const savedProfileRef = useRef<ProfileDetail | undefined>(undefined);
  useEffect(() => {
    if (
      status !== "Profile saved" &&
      status !== "Profile details saved" &&
      status !== "Profile restored"
    ) {
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
    draftProfileRef.current = profile;
    savedProfileRef.current = profile;
    setDraftProfile(profile);
    setIsDirty(false);
    setStatus("");
    onSelectionChange?.(profile.id);
  }, [onSelectionChange]);

  const replaceSavedProfile = useCallback((
    profile: ProfileDetail,
    nextStatus = ""
  ) => {
    setSelectedProfileId(profile.id);
    draftProfileRef.current = profile;
    savedProfileRef.current = profile;
    setDraftProfile(profile);
    setIsDirty(false);
    setStatus(nextStatus);
    onSelectionChange?.(profile.id);
  }, [onSelectionChange]);

  const clearProfile = useCallback(() => {
    invalidateFlow();
    setSelectedProfileId(undefined);
    setProfileLoadingId(undefined);
    draftProfileRef.current = undefined;
    savedProfileRef.current = undefined;
    setDraftProfile(undefined);
    setIsDirty(false);
    setStatus("");
    onSelectionChange?.(undefined);
  }, [invalidateFlow, onSelectionChange]);

  const updateDraft = useCallback((profile: ProfileDetail) => {
    invalidateFlow();
    draftProfileRef.current = profile;
    setDraftProfile(profile);
    setIsDirty(!profileDraftsEqual(profile, savedProfileRef.current));
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
    options.onBeforeLoad?.(isDifferentProfile);
    onBusyChange(true);
    onError(undefined);
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

  const publishSavedProfile = useCallback((
    candidate: ProfileDetail,
    saved: ProfileDetail
  ) => {
    publishSavedProfileState({
      candidate,
      saved,
      profiles,
      targets,
      librarySkills,
      profileLibraryVersions,
      setProfiles,
      setProfileLibraryVersions,
      setSkillUsage,
      setTargetStates,
      onDraftInvalidated
    });
  }, [
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

  const saveDraft = useCallback(async () => {
    if (savePromiseRef.current) return savePromiseRef.current;

    const run = async (): Promise<ProfileDetail | undefined> => {
      setIsSaving(true);
      setStatus("Saving Profile");
      try {
        while (true) {
          const candidate = draftProfileRef.current;
          const base = savedProfileRef.current;
          if (!candidate) return undefined;
          if (profileDraftsEqual(candidate, base)) {
            draftProfileRef.current = base ?? candidate;
            setDraftProfile(base ?? candidate);
            setIsDirty(false);
            setStatus("");
            return base ?? candidate;
          }
          const input = profileSaveInput(candidate);
          const saved = await window.agentEnv.saveProfile({
            ...input,
            expectedContentHash: base?.contentHash ?? input.expectedContentHash
          });
          publishSavedProfile(candidate, saved);
          savedProfileRef.current = saved;
          const latest = draftProfileRef.current;
          if (!latest || latest.id !== saved.id) return saved;
          if (profileDraftsEqual(latest, candidate)) {
            draftProfileRef.current = saved;
            setDraftProfile(saved);
            setIsDirty(false);
            setStatus("Profile saved");
            return saved;
          }

          const rebased = {
            ...latest,
            contentHash: saved.contentHash,
            targetContentHashes: saved.targetContentHashes
          };
          draftProfileRef.current = rebased;
          setDraftProfile(rebased);
          setIsDirty(true);
        }
      } catch (error) {
        setStatus("Profile save failed");
        throw error;
      } finally {
        setIsSaving(false);
      }
    };

    const promise = run().finally(() => {
      savePromiseRef.current = undefined;
    });
    savePromiseRef.current = promise;
    return promise;
  }, [publishSavedProfile]);

  useEffect(() => {
    if (!isDirty || isSaving || status === "Profile save failed") return undefined;
    if (autoSaveTimerRef.current !== undefined) {
      window.clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = undefined;
      void saveDraft().catch((unknownError) => {
        onError(unknownError instanceof Error ? unknownError.message : String(unknownError));
      });
    }, 180);
    return () => {
      if (autoSaveTimerRef.current !== undefined) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = undefined;
      }
    };
  }, [draftProfile, isDirty, isSaving, onError, saveDraft, status]);

  const saveSelectedProfile = useCallback(async () => {
    onError(undefined);
    try {
      return await saveDraft();
    } catch (unknownError) {
      onError(
        unknownError instanceof Error ? unknownError.message : String(unknownError)
      );
      return undefined;
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
    const current = draftProfileRef.current;
    if (current?.id === saved.id) {
      const next = {
        ...current,
        manifest: {
          ...current.manifest,
          name: saved.manifest.name,
          description: saved.manifest.description,
          iconKey: saved.manifest.iconKey as ResourceIconKey | undefined
        },
        contentHash: saved.contentHash,
        targetContentHashes: saved.targetContentHashes
      };
      draftProfileRef.current = next;
      savedProfileRef.current = saved;
      setDraftProfile(next);
      setIsDirty(!profileDraftsEqual(next, saved));
    }
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
