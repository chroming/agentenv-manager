import { createHash } from "node:crypto";
import type { ProfileDetail } from "../shared/types";

type ProfileFingerprintInput = Pick<
  ProfileDetail,
  "manifest" | "instructions" | "resources"
>;

export const createProfileContentHash = (
  profile: ProfileFingerprintInput,
  targetId?: string
): string => {
  const mcpPolicy = targetId ? profile.resources.mcpByTarget[targetId] : undefined;
  const deployment = {
    version: profile.manifest.version,
    targetId: targetId ?? null,
    instructions: profile.instructions,
    skills: [...profile.resources.skills].sort(
      (left, right) =>
        left.targetName.localeCompare(right.targetName) ||
        left.libraryId.localeCompare(right.libraryId)
    ),
    mcp: mcpPolicy?.mode === "manage"
      ? {
          mode: mcpPolicy.mode,
          selections: [...mcpPolicy.selections].sort((left, right) =>
            left.name.localeCompare(right.name)
          )
        }
      : { mode: "ignore", selections: [] }
  };
  return createHash("sha256").update(JSON.stringify(deployment)).digest("hex");
};
