import type { ActivationPreview, ProfileDetail } from "../shared/types";
import type { SkillDeploymentPlan } from "./skillDeploymentPlanner";

export interface InternalActivationPreview extends ActivationPreview {
  targetStateFingerprint: string;
  targetPathFingerprint: string;
  assetBackupPaths: string[];
  missingAssetDirectories: string[];
  legacyOwnershipMarkerPaths: string[];
  adoptedResourcePaths: string[];
  legacyOwnedResourcePaths: string[];
  resourceManagement: {
    instructions: boolean;
    skills: boolean;
    pausedSkillPaths: string[];
  };
  skillDeployment: {
    plan: SkillDeploymentPlan;
    profile: ProfileDetail;
    sourceSkills: ProfileDetail["resources"]["skills"];
    inventoryPreconditionFingerprint: string;
    runtimePreconditionFingerprint: string;
    skillLibraryDir: string;
    skillSyncMethod: "symlink" | "copy" | "auto";
  };
}
