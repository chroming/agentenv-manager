import { Layers3 } from "lucide-react";
import { useId, type ReactNode } from "react";
import { AgentEndpointIcon } from "./AgentEndpointIcon";
import { ChoiceInput } from "./ui";

export const AgentSelectionRow = ({ id, name, checked, disabled, description, detail, profileName, actions, onChange }: {
  id: string; name: string; checked: boolean; disabled: boolean;
  description?: string; detail?: string; profileName?: string; actions?: ReactNode;
  onChange(): void;
}) => {
  const inputId = useId();
  return <div className="agent-discovery-row">
    <ChoiceInput id={inputId} type="checkbox" aria-label={name} checked={checked} disabled={disabled} onChange={onChange} />
    <label className="agent-discovery-choice" htmlFor={inputId}>
      <AgentEndpointIcon target={{ id, name }} size={20} />
      <span className="agent-discovery-copy">
        <span>{name}</span>
        {description ? <small title={detail ?? description}>{description}</small> : null}
      </span>
      {profileName ? <span title={profileName} aria-label={profileName}><Layers3 size={14} aria-hidden="true" /></span> : null}
    </label>
    {actions}
  </div>;
};
