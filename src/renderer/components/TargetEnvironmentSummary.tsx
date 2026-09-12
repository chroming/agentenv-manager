import { TextAction } from "./ui";

export const TargetEnvironmentSummary = ({ lifecycle, profileName, actionLabel, onAction }: {
  lifecycle: string;
  profileName?: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <span className={`target-workflow-environment${profileName || onAction ? "" : " target-workflow-environment--single"}`}>
    {onAction ? <TextAction title={profileName} onClick={onAction}>{actionLabel ?? profileName}</TextAction> : null}
    <span className="target-workflow-lifecycle">{lifecycle}</span>
    {profileName && !onAction ? <span className="target-workflow-profile">{profileName}</span> : null}
  </span>
);
