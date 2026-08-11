import { useCallback, useMemo, useState } from "react";
import type { AgentEnvSettings, SkillInventoryEntry } from "../../shared/types";

interface UseSkillDeploymentUpgradeOptions {
  inventory: SkillInventoryEntry[];
  isLoading: boolean;
  settings: AgentEnvSettings;
  telemetryOpen: boolean;
  updateSettings(input: Partial<AgentEnvSettings>): Promise<AgentEnvSettings | undefined>;
}

export const useSkillDeploymentUpgrade = ({
  inventory,
  isLoading,
  settings,
  telemetryOpen,
  updateSettings
}: UseSkillDeploymentUpgradeOptions) => {
  const [dismissed, setDismissed] = useState(false);
  const linkedInstallCount = useMemo(() => new Set(
    inventory
      .filter((item) => item.installMethod === "linked")
      .map((item) => item.path)
  ).size, [inventory]);
  const decide = useCallback(async (skillSyncMethod: "copy" | "symlink") => {
    const next = await updateSettings({
      skillSyncMethod,
      skillDeploymentPreferenceVersion: 1,
      skillDeploymentReviewPending: false
    });
    if (next) setDismissed(true);
  }, [updateSettings]);

  return {
    currentMethod: settings.skillSyncMethod,
    linkedInstallCount,
    onDecide: decide,
    onDismiss: () => setDismissed(true),
    open:
      !isLoading &&
      Boolean(settings.skillDeploymentReviewPending) &&
      !dismissed &&
      !telemetryOpen
  };
};
