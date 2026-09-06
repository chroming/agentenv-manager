import { useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { AIAnalysisReview } from "./AIAnalysisReview";
import { ModalFrame, DialogHeader, IconButton } from "./ui";

export const ProfileAnalysisDialog = ({ profileId, targetId, profileName, targetName, onClose }: { profileId: string; targetId: string; profileName: string; targetName: string; onClose(): void }) => {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalDialog({ open: true, dialogRef, initialFocusRef: closeRef, onDismiss: onClose });
  return <ModalFrame ariaLabel={t("Profile analysis")} dialogRef={dialogRef} onDismiss={onClose} size="default" maximized={maximized} className="ui-dialog-shell">
    <DialogHeader title={t("Profile analysis")} description={`${profileName} · ${targetName}`} actions={<IconButton label={t(maximized ? "Restore" : "Maximize preview")} onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>} />
    <AIAnalysisReview standalone subject={{ kind: "profile", profileId, targetId }} onClose={onClose} closeRef={closeRef} />
  </ModalFrame>;
};
