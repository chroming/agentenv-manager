import { Columns2, Info } from "lucide-react";
import type { Ref } from "react";
import type { ProfileComparisonControl } from "../profileReadiness";
import { Button } from "./ui";

interface ProfileComparisonButtonProps {
  buttonRef: Ref<HTMLButtonElement>;
  control: ProfileComparisonControl;
  description: string;
  label: string;
  onClick(): void;
}

export const ProfileComparisonButton = ({
  buttonRef,
  control,
  description,
  label,
  onClick
}: ProfileComparisonButtonProps) => (
  <>
    <Button
      ref={buttonRef}
      className={`profile-evaluate-button${control.unavailableReason ? " is-unavailable" : ""}`}
      disabled={control.disabled}
      icon={control.unavailableReason
        ? <Info size={15} strokeWidth={2.2} />
        : <Columns2 size={15} strokeWidth={2.2} />}
      aria-describedby={control.unavailableReason ? "profile-comparison-unavailable" : undefined}
      title={description}
      onClick={onClick}
    >
      {label}
    </Button>
    {control.unavailableReason ? (
      <span id="profile-comparison-unavailable" hidden>{description}</span>
    ) : null}
  </>
);
