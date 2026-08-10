import { useLayoutEffect, useRef, useState } from "react";
import type { TelemetryPreview } from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  Switch
} from "./ui";

interface TelemetryConsentDialogProps {
  busy: boolean;
  open: boolean;
  preview?: TelemetryPreview;
  onDismiss(): void;
  onDecide(enabled: boolean): Promise<void>;
}

export const TelemetryConsentDialog = ({
  busy,
  open,
  preview,
  onDismiss,
  onDecide
}: TelemetryConsentDialogProps) => {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const [enabled, setEnabled] = useState(true);

  useLayoutEffect(() => {
    if (open) setEnabled(true);
  }, [open]);

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: continueRef,
    dismissDisabled: busy,
    onDismiss
  });

  if (!open) return null;

  return (
    <ModalFrame
      ariaLabel={t("Anonymous usage statistics")}
      className="telemetry-consent-dialog ui-dialog-shell"
      dialogRef={dialogRef}
      dismissDisabled={busy}
      onDismiss={onDismiss}
    >
      <DialogHeader
        title={t("Help improve AgentEnv")}
        description={t("Choose whether AgentEnv may send one anonymous startup event per day.")}
      />
      <DialogBody className="telemetry-consent-body">
        <SettingsPreferenceRow
          className="telemetry-consent-choice"
          label={t("Anonymous usage statistics")}
          description={t("You can change this later in Settings.")}
          control={(
            <Switch
              checked={enabled}
              disabled={busy}
              label={t("Share anonymous usage statistics")}
              onClick={() => setEnabled((current) => !current)}
            />
          )}
        />
        <div className="telemetry-consent-details">
          <p>{t("AgentEnv shares its version, operating-system family and major version, architecture, interface language, install channel, and a random installation ID.")}</p>
          <p>{t("It never shares actions, results, paths, names, repositories, Profiles, Skills, conversations, prompts, or file contents.")}</p>
          <small>{t("Destination: {{destination}}", { destination: preview?.destination ?? "PostHog Cloud" })}</small>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button disabled={busy} onClick={onDismiss}>{t("Decide later")}</Button>
        <Button
          ref={continueRef}
          variant="primary"
          busy={busy}
          disabled={busy}
          onClick={() => void onDecide(enabled)}
        >
          {t("Continue")}
        </Button>
      </DialogFooter>
    </ModalFrame>
  );
};
