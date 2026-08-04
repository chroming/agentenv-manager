import type { RefObject } from "react";
import { Copy } from "lucide-react";
import { useI18n } from "../i18n";
import { Button } from "./ui";

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
    <footer className="preview-actions ui-dialog-footer">
      <Button
        disabled={working}
        icon={<Copy size={15} strokeWidth={2.2} aria-hidden="true" />}
        onClick={onCopy}
      >
        {t(copied ? "Copied" : "Copy details")}
      </Button>
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
    </footer>
  );
};
