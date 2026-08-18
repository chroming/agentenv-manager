import type { ProfileResourceMode, ProfileSkill } from "./schemas";
import { normalizeSkillKey } from "./skillIdentity";
import type {
  ProfileDetail,
  SkillInventoryEntry,
  SkillLibraryEntry
} from "./types";

interface ProfileSharedSkillBoundaryInput {
  profile: ProfileDetail;
  targetId?: string;
  policy: ProfileResourceMode;
  inventory: readonly SkillInventoryEntry[];
  librarySkills: readonly SkillLibraryEntry[];
}

export interface ProfileSharedSkillBoundary {
  activeLibraryIds: string[];
  activePaths: string[];
  allActiveManaged: boolean;
  migrationPaths: string[];
  retainedPaths: string[];
}

const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort();

const runtimeAvailabilityFor = (
  entry: SkillInventoryEntry,
  targetId?: string
) =>
  entry.runtimeStates?.find((state) => state.targetId === targetId)?.availability ??
    entry.runtimeAvailability ??
    "unknown";

const runtimeKeysFor = (
  entry: SkillInventoryEntry,
  libraryById: ReadonlyMap<string, SkillLibraryEntry>
) => new Set(
  [
    entry.skillKey,
    entry.runtimeName,
    entry.deploymentName,
    entry.id,
    entry.name,
    entry.libraryId ? libraryById.get(entry.libraryId)?.name : undefined
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeSkillKey)
);

const referenceMatchesEntry = (
  reference: ProfileSkill,
  entry: SkillInventoryEntry,
  libraryById: ReadonlyMap<string, SkillLibraryEntry>
) => {
  if (entry.libraryId && reference.libraryId === entry.libraryId) return true;
  const entryKeys = runtimeKeysFor(entry, libraryById);
  return entryKeys.has(normalizeSkillKey(reference.targetName)) ||
    entryKeys.has(normalizeSkillKey(libraryById.get(reference.libraryId)?.name ?? ""));
};

const profileAcceptsSharedEntry = (
  profile: ProfileDetail,
  entry: SkillInventoryEntry,
  libraryById: ReadonlyMap<string, SkillLibraryEntry>
) => {
  const enabledReference = profile.resources.skills.find(
    (reference) =>
      reference.enabled && referenceMatchesEntry(reference, entry, libraryById)
  );
  if (!enabledReference) return false;
  return Boolean(
    entry.managedAsShared === true &&
    entry.libraryId &&
    enabledReference.libraryId === entry.libraryId &&
    entry.contentMatchesLibrary !== false
  );
};

export const profileSharedSkillBoundary = ({
  profile,
  targetId,
  policy,
  inventory,
  librarySkills
}: ProfileSharedSkillBoundaryInput): ProfileSharedSkillBoundary => {
  const libraryById = new Map(librarySkills.map((skill) => [skill.id, skill]));
  const activeSharedEntries = inventory.filter((entry) => {
    if (!entry.sharedLocation && !entry.collectionLink) return false;
    const availability = runtimeAvailabilityFor(entry, targetId);
    return availability !== "disabled" && availability !== "shadowed";
  });
  const retainedEntries = activeSharedEntries.filter(
    (entry) => entry.status === "left-unmanaged"
  );
  const controlledEntries = activeSharedEntries.filter(
    (entry) => entry.status !== "left-unmanaged"
  );
  const migrationEntries = policy === "ignore"
    ? []
    : controlledEntries.filter(
        (entry) =>
          policy === "disable" ||
          !profileAcceptsSharedEntry(profile, entry, libraryById)
      );
  const pathFor = (entry: SkillInventoryEntry) => entry.collectionLink?.path ?? entry.path;

  return {
    activeLibraryIds: uniqueSorted(
      controlledEntries.flatMap((entry) => entry.libraryId ? [entry.libraryId] : [])
    ),
    activePaths: uniqueSorted(controlledEntries.map(pathFor)),
    allActiveManaged: controlledEntries.length > 0 && controlledEntries.every(
      (entry) => entry.managedAsShared && entry.contentMatchesLibrary === true
    ),
    migrationPaths: uniqueSorted(migrationEntries.map(pathFor)),
    retainedPaths: uniqueSorted(retainedEntries.map(pathFor))
  };
};
