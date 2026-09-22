import { CircleAlert, Clock3, Info, TriangleAlert } from "lucide-react";
import type { TargetLifecycleStatus } from "../../shared/types";
import { StatusHint } from "./ui";

export const TargetEnvironmentSummary = ({ lifecycle, lifecycleStatus, profileName, emptyLabel }: {
  lifecycle: string;
  lifecycleStatus?: TargetLifecycleStatus;
  profileName?: string;
  emptyLabel: string;
}) => {
  const exceptional = Boolean(
    lifecycleStatus && lifecycleStatus !== "applied" && lifecycleStatus !== "unmanaged"
  );
  const primary = profileName ?? (exceptional ? lifecycle : emptyLabel);
  return (
    <span className="target-workflow-environment">
      <span className="target-workflow-profile" title={lifecycle}>{primary}</span>
      {profileName && exceptional ? (
      <StatusHint
        label={lifecycle}
        detail={profileName}
        icon={lifecycleStatus === "pending" ? <Clock3 /> : lifecycleStatus === "recovery-required" ? <TriangleAlert /> : lifecycleStatus === "drifted" ? <CircleAlert /> : <Info />}
      />
      ) : null}
    </span>
  );
};
