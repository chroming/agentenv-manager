import { useEffect, useMemo, useRef, useState } from "react";
import type { SkillInventoryEntry } from "../../shared/types";

interface UseSkillManagementMigrationOptions {
  inventory: SkillInventoryEntry[];
  isLoading: boolean;
  telemetryOpen: boolean;
}

export const useSkillManagementMigration = ({
  inventory,
  isLoading,
  telemetryOpen
}: UseSkillManagementMigrationOptions) => {
  const [dismissed, setDismissed] = useState(false);
  const [startupMarkerCount, setStartupMarkerCount] = useState<number>();
  const startupDecisionMadeRef = useRef(false);
  const legacyMarkerCount = useMemo(() => new Set(
    inventory.flatMap((item) => item.legacyOwnershipMarkerPaths ?? [])
  ).size, [inventory]);

  useEffect(() => {
    if (isLoading || telemetryOpen || startupDecisionMadeRef.current) return;
    startupDecisionMadeRef.current = true;
    setStartupMarkerCount(legacyMarkerCount);
  }, [isLoading, legacyMarkerCount, telemetryOpen]);

  return {
    legacyMarkerCount: startupMarkerCount ?? 0,
    onDismiss: () => setDismissed(true),
    onReview: () => setDismissed(true),
    open:
      !isLoading &&
      (startupMarkerCount ?? 0) > 0 &&
      !dismissed &&
      !telemetryOpen
  };
};
