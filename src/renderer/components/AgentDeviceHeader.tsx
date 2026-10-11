import type { ReactNode } from "react";
import { OverflowTooltip } from "./OverflowTooltip";
import { ControlGroup } from "./ui";

export const AgentDeviceHeader = ({ icon, name, detail, status, actions }: {
  icon: ReactNode; name: string; detail?: string; status?: ReactNode; actions: ReactNode;
}) => <header className="agent-device-header">
  <span className="agent-device-header__identity">
    <span aria-hidden="true">{icon}</span>
    <OverflowTooltip className="agent-device-header__name" displayText={name} text={detail ? `${name}\n${detail}` : name} />
    {status !== undefined && status !== null ? <span className="agent-device-header__status">{status}</span> : null}
  </span>
  <ControlGroup density="compact">{actions}</ControlGroup>
</header>;
