import type { RefObject } from "react";
import { Copy, LoaderCircle } from "lucide-react";
import { useI18n } from "../i18n";

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
      <button
        className="secondary-action"
        type="button"
        disabled={working}
        onClick={onCopy}
      >
        <Copy size={15} strokeWidth={2.2} aria-hidden="true" />
        {t(copied ? "Copied" : "Copy details")}
      </button>
      <button
        ref={initialFocusRef}
        className="secondary-action"
        type="button"
        disabled={working}
        onClick={onClose}
      >
        {t("Close")}
      </button>
      {removable ? (
        <button
          className="primary-action"
          type="button"
          aria-busy={working}
          disabled={busy}
          onClick={onRemove}
        >
          {working ? (
            <LoaderCircle className="is-spinning" size={15} aria-hidden="true" />
          ) : null}
          {t(working ? "Cleaning up..." : "Remove unavailable links")}
        </button>
      ) : null}
    </footer>
  );
};
