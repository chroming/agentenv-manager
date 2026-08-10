import type { Dispatch, SetStateAction } from "react";
import { collectLibraryResourceVersions } from "../../shared/libraryVersions";
import type {
  LibraryResourceVersions,
  ProfileDetail,
  ProfileSummary,
  SkillLibraryEntry,
  TargetInfo,
  TargetManagementState
} from "../../shared/types";
import { reconcileProfileUsage } from "../profileSummary";

interface PublishSavedProfileOptions {
  candidate: ProfileDetail;
  saved: ProfileDetail;
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
  onDraftInvalidated(): void;
}

export const publishSavedProfileState = ({
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
}: PublishSavedProfileOptions) => {
  const previousName = profiles.find((profile) => profile.id === candidate.id)?.name ??
    candidate.manifest.name;
  const previousLibraryVersions = profileLibraryVersions[candidate.id];
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
  setProfiles((current) => current.some((profile) => profile.id === saved.id)
    ? current.map((profile) => profile.id === saved.id ? summary : profile)
    : current.concat(summary));
  const preferredTarget = targets.find(
    (target) => target.id === saved.manifest.preferredTargetId
  ) ?? targets[0];
  setProfileLibraryVersions((current) => ({
    ...current,
    [saved.id]: collectLibraryResourceVersions(saved, librarySkills, preferredTarget?.id)
  }));
  setSkillUsage((current) => reconcileProfileUsage(
    current,
    Object.keys(previousLibraryVersions?.skills ?? {}),
    saved.resources.skills.map((reference) => reference.libraryId),
    previousName,
    saved.manifest.name
  ));
  setTargetStates((current) => current.map((targetState) => {
    if (targetState.activeProfileId !== saved.id) return targetState;
    const expectedHash = saved.targetContentHashes?.[targetState.targetId];
    const contentChanged = !expectedHash || expectedHash !== targetState.appliedProfileHash;
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
  }));
  onDraftInvalidated();
};
