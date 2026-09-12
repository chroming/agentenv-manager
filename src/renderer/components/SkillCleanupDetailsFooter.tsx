import type { RefObject } from "react";
import { Check, Copy } from "lucide-react";
import { useI18n } from "../i18n";
import { Button, DialogFooter, IconButton } from "./ui";

interface SkillCleanupDetailsFooterProps {
  busy: boolean;
  copied: boolean;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  removable: boolean;
  working: boolean;
  onClose(): void;
  onCopy(): void;
  onRemove(): void;
}

export const SkillCleanupDetailsFooter = ({
  busy,
  copied,
  initialFocusRef,
  removable,
  working,
  onClose,
  onCopy,
  onRemove
}: SkillCleanupDetailsFooterProps) => {
  const { t } = useI18n();

  return (
    <DialogFooter>
      <IconButton
        variant="ghost"
        label={t(copied ? "Copied" : "Copy details")}
        disabled={working}
        onClick={onCopy}
      >
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      </IconButton>
      <Button
        ref={initialFocusRef}
        disabled={working}
        onClick={onClose}
      >
        {t("Close")}
      </Button>
      {removable ? (
        <Button
          variant="primary"
          busy={working}
          disabled={busy}
          onClick={onRemove}
        >
          {t(working ? "Cleaning up..." : "Remove unavailable links")}
        </Button>
      ) : null}
    </DialogFooter>
  );
};
