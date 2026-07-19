import type { PlannedOmission, ProfileDetail } from "../shared/types";
import type { AgentTargetAdapter } from "./targets/types";

export interface TargetedProfile {
  profile: ProfileDetail;
  warnings: string[];
  omissions: PlannedOmission[];
}

export const targetProfile = (
  source: ProfileDetail,
  adapter: AgentTargetAdapter,
  sourceAdapter?: AgentTargetAdapter
): TargetedProfile => {
  if (source.manifest.targetId === adapter.descriptor.id) {
    return { profile: source, warnings: [], omissions: [] };
  }

  const defaults = adapter.createDefaultProfile(source.id);
  const omittedAgents =
    source.assetPolicy.ownedDirs.filter((asset) => asset.kind === "agent").length +
    source.assetPolicy.ownedFiles.filter((asset) => asset.kind === "agent").length;
  const compactNativeConfig = source.configText.replace(/\s/g, "");
  const hasNativeConfig = sourceAdapter
    ? sourceAdapter.hasMeaningfulNativeConfig(source.configText)
    : compactNativeConfig.length > 0 && compactNativeConfig !== "{}";
  const hasDisabledSkills = source.assetPolicy.disabledSkillPaths.length > 0;
  const warnings: string[] = [];
  const omissions: PlannedOmission[] = [];

  if (hasNativeConfig) {
    const reason = `${source.manifest.targetId} Advanced config is Agent-specific and is not applied to ${adapter.descriptor.name}`;
    warnings.push(reason);
    omissions.push({ kind: "config", name: "Advanced config", reason });
  }
  if (omittedAgents > 0) {
    const reason = `${omittedAgents} native agent ${omittedAgents === 1 ? "asset is" : "assets are"} not applied to ${adapter.descriptor.name}`;
    warnings.push(reason);
    omissions.push({ kind: "agent", name: `${omittedAgents} agent ${omittedAgents === 1 ? "asset" : "assets"}`, reason });
  }
  if (hasDisabledSkills) {
    const reason = `Disabled Skill paths are Agent-specific and are not applied to ${adapter.descriptor.name}`;
    warnings.push(reason);
    omissions.push({ kind: "setting", name: "Disabled skill paths", reason });
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
        mcpRefs: [],
        disabledSkillPaths: []
      },
      contentHash: undefined,
      targetContentHashes: undefined
    },
    warnings,
    omissions
  };
};
