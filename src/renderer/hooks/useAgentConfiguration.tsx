import { useRef, useState } from "react";
import type { ProfileSummary, TargetInfo, TargetManagementState } from "../../shared/types";
import { deriveAgentSetupAction } from "../agentSetup";
import { useI18n } from "../i18n";
import { useModalDialog } from "./useModalDialog";
import { Button, DialogBody, DialogFooter, DialogHeader, ModalFrame, SelectField } from "../components/ui";

export const useAgentConfiguration = ({ profiles, targets, states, onSelect, onCapture, onCreate }: {
  profiles: ProfileSummary[];
  targets: TargetInfo[];
  states: TargetManagementState[];
  onSelect(profileId: string, targetId: string): void;
  onCapture(targetId: string): void;
  onCreate(targetId: string): void;
}) => {
  const { t } = useI18n();
  const [targetId, setTargetId] = useState<string>();
  const [profileId, setProfileId] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const target = targets.find((item) => item.id === targetId);
  const close = () => setTargetId(undefined);
  useModalDialog({ open: Boolean(target), dialogRef, initialFocusRef: cancelRef, onDismiss: close });
  const available = profiles.filter((profile) => !profile.loadError);
  const remote = target?.location?.kind === "ssh";
  const createProfile = () => {
    if (!target) return;
    close();
    if (remote) onCreate(target.id); else onCapture(target.id);
  };
  const openAgentConfiguration = (id: string) => {
    const state = states.find((item) => item.targetId === id);
    if (state?.activeProfileId) {
      onSelect(state.activeProfileId, id);
      return;
    }
    const suggestion = deriveAgentSetupAction(id, profiles, states);
    setProfileId(suggestion.kind === "continue-profile" ? suggestion.profileId : "");
    setTargetId(id);
  };
  const agentConfigurationDialog = target ? (
    <ModalFrame ariaLabel={t("Set up {{name}}", { name: target.name })}
      className="ui-dialog-shell profile-form-dialog--compact" dialogRef={dialogRef} onDismiss={close}>
      <DialogHeader title={t("Set up {{name}}", { name: target.name })}
        description={t("Choose a Profile to edit and preview. Nothing is applied by this step.")} />
      <DialogBody className="profile-form-grid">
        {available.length > 0 ? <SelectField label={t("Profile")} value={profileId}
          onChange={(event) => setProfileId(event.currentTarget.value)}>
          <option value="">{t("Choose Profile")}</option>
          {available.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </SelectField> : null}
        {remote ? <p className="muted">{t("Remote capture is not supported. Use a saved Profile or create an empty one.")}</p> : null}
        {!remote && !target.health.canWrite ? <p className="muted">{target.health.installationFound ? target.health.summary : t("Installation not detected")}</p> : null}
        {available.length > 0 ? <Button disabled={!remote && !target.health.canWrite} onClick={createProfile}>
          {t(remote ? "New Profile" : "Create from current environment")}
        </Button> : null}
      </DialogBody>
      <DialogFooter>
        <Button ref={cancelRef} onClick={close}>{t("Cancel")}</Button>
        {available.length > 0 ? <Button variant="primary" disabled={!available.some((profile) => profile.id === profileId)}
          onClick={() => { close(); onSelect(profileId, target.id); }}>{t("Use selected Profile")}</Button>
          : <Button variant="primary" disabled={!remote && !target.health.canWrite} onClick={createProfile}>
            {t(remote ? "New Profile" : "Create from current environment")}
          </Button>}
      </DialogFooter>
    </ModalFrame>
  ) : null;
  return { openAgentConfiguration, agentConfigurationDialog };
};
