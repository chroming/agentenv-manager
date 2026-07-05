import { createHash } from "node:crypto";
import type { ProfileDetail } from "../shared/types";

type ProfileFingerprintInput = Pick<
  ProfileDetail,
  "manifest" | "instructions" | "configText" | "assetPolicy"
>;

const byIdentity = <T extends { targetName: string }>(left: T, right: T) =>
  left.targetName.localeCompare(right.targetName);

export const createProfileContentHash = (profile: ProfileFingerprintInput): string => {
  const deployment = {
    targetId: profile.manifest.targetId,
    managed: profile.manifest.managed,
    instructions: profile.instructions,
    configText: profile.configText,
    assetPolicy: {
      ownedDirs: [...profile.assetPolicy.ownedDirs].sort(byIdentity),
      ownedFiles: [...profile.assetPolicy.ownedFiles].sort(byIdentity),
      skillRefs: [...profile.assetPolicy.skillRefs].sort(byIdentity),
      mcpRefs: [...profile.assetPolicy.mcpRefs].sort(byIdentity),
      disabledSkillPaths: [...profile.assetPolicy.disabledSkillPaths].sort()
    }
  };

  return createHash("sha256").update(JSON.stringify(deployment)).digest("hex");
};
