import { useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { AIAnalysisReview } from "./AIAnalysisReview";
import { Button, ModalFrame, DialogHeader, DialogBody, DialogFooter, IconButton } from "./ui";

export const ProfileAnalysisDialog = ({ profileId, targetId, onClose }: { profileId: string; targetId: string; onClose(): void }) => {
  const { t } = useI18n();
  const [maximized, setMaximized] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalDialog({ open: true, dialogRef, initialFocusRef: closeRef, onDismiss: onClose });
  return <ModalFrame ariaLabel={t("Profile analysis")} dialogRef={dialogRef} onDismiss={onClose} size="wide" maximized={maximized} className="ui-dialog-shell">
    <DialogHeader title={t("Profile analysis")} actions={<IconButton label={t(maximized ? "Restore" : "Maximize preview")} onClick={() => setMaximized(!maximized)}>{maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</IconButton>} />
    <DialogBody><AIAnalysisReview subject={{ kind: "profile", profileId, targetId }} /></DialogBody>
    <DialogFooter><Button ref={closeRef} onClick={onClose}>{t("Close")}</Button></DialogFooter>
  </ModalFrame>;
};
