import type { ProfileDetail } from "../shared/types";
import type { AgentTargetAdapter } from "./targets/types";

export interface TargetedProfile {
  profile: ProfileDetail;
  warnings: string[];
}

export const targetProfile = (
  source: ProfileDetail,
  adapter: AgentTargetAdapter
): TargetedProfile => {
  if (source.manifest.targetId === adapter.descriptor.id) {
    return { profile: source, warnings: [] };
  }

  const defaults = adapter.createDefaultProfile(source.id);
  const omittedAgents =
    source.assetPolicy.ownedDirs.filter((asset) => asset.kind === "agent").length +
    source.assetPolicy.ownedFiles.filter((asset) => asset.kind === "agent").length;
  const compactNativeConfig = source.configText.replace(/\s/g, "");
  const hasNativeConfig = compactNativeConfig.length > 0 && compactNativeConfig !== "{}";
  const hasDisabledSkills = source.assetPolicy.disabledSkillPaths.length > 0;
  const warnings: string[] = [];

  if (hasNativeConfig) {
    warnings.push(
      `${source.manifest.targetId} Advanced config is target-specific and is not applied to ${adapter.descriptor.name}`
    );
  }
  if (omittedAgents > 0) {
    warnings.push(
      `${omittedAgents} target-specific agent ${omittedAgents === 1 ? "asset is" : "assets are"} not applied to ${adapter.descriptor.name}`
    );
  }
  if (hasDisabledSkills) {
    warnings.push(
      `Disabled skill paths are target-specific and are not applied to ${adapter.descriptor.name}`
    );
  }

  return {
    profile: {
      ...source,
      manifest: {
        ...source.manifest,
        targetId: adapter.descriptor.id,
        managed: {
          instructions: source.manifest.managed.instructions,
          config: true,
          assets: source.manifest.managed.assets
        }
      },
      configText: defaults.configText,
      assetPolicy: {
        ...source.assetPolicy,
        ownedDirs: source.assetPolicy.ownedDirs.filter((asset) => asset.kind === "skill"),
        ownedFiles: [],
        disabledSkillPaths: []
      },
      contentHash: undefined,
      targetContentHashes: undefined
    },
    warnings
  };
};
