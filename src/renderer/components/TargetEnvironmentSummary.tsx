export const TargetEnvironmentSummary = ({ lifecycle, profileName }: {
  lifecycle: string;
  profileName?: string;
}) => (
  <span className={`target-workflow-environment${profileName ? "" : " target-workflow-environment--single"}`}>
    <strong className="target-workflow-lifecycle">{lifecycle}</strong>
    {profileName ? <span className="target-workflow-profile">{profileName}</span> : null}
  </span>
);
