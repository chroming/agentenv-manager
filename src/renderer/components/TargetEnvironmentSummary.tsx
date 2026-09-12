import { CircleAlert, Clock3, Info, TriangleAlert } from "lucide-react";
import type { TargetLifecycleStatus } from "../../shared/types";
import { StatusHint, TextAction } from "./ui";

export const TargetEnvironmentSummary = ({ lifecycle, lifecycleStatus, profileName, actionLabel, onAction, actionOnly = false }: {
  lifecycle: string;
  lifecycleStatus?: TargetLifecycleStatus;
  profileName?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionOnly?: boolean;
}) => (
  <span className="target-workflow-environment">
    {onAction ? <TextAction title={[profileName, !actionOnly && lifecycle].filter(Boolean).join("\n")} onClick={onAction}>{actionLabel ?? profileName ?? lifecycle}</TextAction>
      : <span className="target-workflow-profile" title={lifecycle}>{profileName ?? lifecycle}</span>}
    {!actionOnly && lifecycleStatus && lifecycleStatus !== "applied" && lifecycleStatus !== "unmanaged" ? (
      <StatusHint
        label={lifecycle}
        detail={profileName}
        icon={lifecycleStatus === "pending" ? <Clock3 /> : lifecycleStatus === "recovery-required" ? <TriangleAlert /> : lifecycleStatus === "drifted" ? <CircleAlert /> : <Info />}
      />
    ) : null}
  </span>
);
