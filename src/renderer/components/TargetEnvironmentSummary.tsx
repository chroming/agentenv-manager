import { TextAction } from "./ui";

export const TargetEnvironmentSummary = ({ lifecycle, profileName, actionLabel, onAction, actionOnly = false }: {
  lifecycle: string;
  profileName?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionOnly?: boolean;
}) => (
  <span className={`target-workflow-environment${!actionOnly && (profileName || onAction) ? "" : " target-workflow-environment--single"}`}>
    {onAction ? <TextAction title={profileName} onClick={onAction}>{actionLabel ?? profileName}</TextAction> : null}
    {!actionOnly ? <span className="target-workflow-lifecycle">{lifecycle}</span> : null}
    {profileName && !onAction ? <span className="target-workflow-profile">{profileName}</span> : null}
  </span>
);
