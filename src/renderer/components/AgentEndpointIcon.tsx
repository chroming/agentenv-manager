import { Monitor, Server } from "lucide-react";
import type { TargetInfo } from "../../shared/types";
import { targetIconFor } from "./ProfileSidebar";

export const AgentEndpointIcon = ({
  target,
  size = 16,
  className = ""
}: {
  target: TargetInfo;
  size?: number;
  className?: string;
}) => {
  const icon = targetIconFor(target);
  return (
    <span className={`agent-endpoint-icon ${target.location ? "is-remote" : "is-local"} ${className}`.trim()}>
      {icon.assetUrl ? (
        <img
          className={`agent-endpoint-icon__logo agent-endpoint-icon__logo--${icon.flavor}`}
          src={icon.assetUrl}
          alt=""
          style={{ height: size, width: size }}
        />
      ) : (
        <Monitor size={size} strokeWidth={2.1} aria-hidden="true" />
      )}
      {target.location ? (
        <span className="agent-endpoint-icon__remote-badge" aria-hidden="true">
          <Server size={7} strokeWidth={2.5} />
        </span>
      ) : null}
    </span>
  );
};
