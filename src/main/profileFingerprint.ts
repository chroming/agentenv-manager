import { createHash } from "node:crypto";
import type { ProfileDetail } from "../shared/types";
import { profileResourceMode } from "../shared/profileResources";

type ProfileFingerprintInput = Pick<
  ProfileDetail,
  "manifest" | "instructions" | "resources"
>;

const canonicalProfileValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalProfileValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalProfileValue(item)])
  );
};

export const createProfileSnapshotHash = (
  profile: ProfileFingerprintInput
): string => createHash("sha256").update(JSON.stringify(canonicalProfileValue({
  manifest: profile.manifest,
  instructions: profile.instructions,
  resources: profile.resources
}))).digest("hex");

export const createProfileContentHash = (
  profile: ProfileFingerprintInput,
  targetId?: string
): string => {
  const mcpPolicy = targetId ? profile.resources.mcpByTarget[targetId] : undefined;
  const instructionsMode = targetId
    ? profileResourceMode(profile.resources, targetId, "instructions")
    : "manage";
  const skillsMode = targetId
    ? profileResourceMode(profile.resources, targetId, "skills")
    : "manage";
  const deployment = {
    version: profile.manifest.version,
    targetId: targetId ?? null,
    management: {
      instructions: instructionsMode,
      skills: skillsMode,
      mcp: mcpPolicy?.mode ?? "ignore"
    },
    instructions: instructionsMode === "manage" ? profile.instructions : null,
    skills: skillsMode !== "ignore"
      ? [...profile.resources.skills]
          .map((reference) => ({
            ...reference,
            enabled:
              skillsMode === "disable" ? false : reference.enabled
          }))
          .sort(
            (left, right) =>
              left.targetName.localeCompare(right.targetName) ||
              left.libraryId.localeCompare(right.libraryId)
          )
      : [],
    mcp: mcpPolicy?.mode === "manage"
      ? {
          mode: mcpPolicy.mode,
          selections: [...mcpPolicy.selections].sort((left, right) =>
            left.name.localeCompare(right.name)
          )
        }
      : mcpPolicy?.mode === "disable"
        ? {
            mode: mcpPolicy.mode,
            selections: [...mcpPolicy.selections]
              .map((selection) => ({ ...selection, enabled: false }))
              .sort((left, right) => left.name.localeCompare(right.name))
          }
        : { mode: "ignore", selections: [] }
  };
  return createHash("sha256").update(JSON.stringify(deployment)).digest("hex");
};
