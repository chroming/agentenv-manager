import { MonitorUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type {
  CreateRemoteDeviceInput,
  RemoteAgentEndpoint,
  RemoteDevice
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import {
  Button,
  DialogBody,
  DialogFooter,
  DialogHeader,
  IconButton,
  ModalFrame,
  TextField
} from "./ui";

interface RemoteDeviceManagerProps {
  devices: RemoteDevice[];
  endpoints: RemoteAgentEndpoint[];
  busy: boolean;
  onAdd(input: CreateRemoteDeviceInput): Promise<void>;
  onUpdate(input: CreateRemoteDeviceInput & { id: string }): Promise<void>;
  onRemove(id: string): Promise<void>;
  onRefresh(): Promise<void>;
}

const EMPTY_FORM: CreateRemoteDeviceInput = { name: "", host: "" };

export const RemoteDeviceManager = ({
  devices,
  endpoints,
  busy,
  onAdd,
  onUpdate,
  onRemove,
  onRefresh
}: RemoteDeviceManagerProps) => {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string>();
  const [removingId, setRemovingId] = useState<string>();
  const [form, setForm] = useState<CreateRemoteDeviceInput>(EMPTY_FORM);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = editingId !== undefined || removingId !== undefined;
  const removingDevice = devices.find((device) => device.id === removingId);
  const editorTitle = editingId === "new" ? t("Add SSH device") : t("Edit SSH device");
  const endpointsByDevice = useMemo(() => {
    const result = new Map<string, RemoteAgentEndpoint[]>();
    for (const endpoint of endpoints) {
      result.set(endpoint.deviceId, [...(result.get(endpoint.deviceId) ?? []), endpoint]);
    }
    return result;
  }, [endpoints]);

  const close = () => {
    if (busy) return;
    setEditingId(undefined);
    setRemovingId(undefined);
    setForm(EMPTY_FORM);
    setError("");
  };

  useModalDialog({
    open,
    dialogRef,
    initialFocusRef: nameRef,
    fallbackFocusRef: returnFocusRef,
    onDismiss: close,
    dismissDisabled: busy
  });

  const startAdd = (element: HTMLElement) => {
    returnFocusRef.current = element;
    setForm(EMPTY_FORM);
    setError("");
    setEditingId("new");
  };

  const startEdit = (device: RemoteDevice, element: HTMLElement) => {
    returnFocusRef.current = element;
    setForm({
      name: device.name,
      host: device.host,
      user: device.user,
      port: device.port
    });
    setError("");
    setEditingId(device.id);
  };

  const startRemove = (device: RemoteDevice, element: HTMLElement) => {
    returnFocusRef.current = element;
    setError("");
    setEditingId(undefined);
    setRemovingId(device.id);
  };

  const submit = async () => {
    try {
      setError("");
      if (editingId === "new") await onAdd(form);
      else if (editingId) await onUpdate({ id: editingId, ...form });
      setEditingId(undefined);
      setForm(EMPTY_FORM);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  return (
    <section className="remote-device-section" aria-label={t("SSH devices")}>
      <header className="remote-device-section__header">
        <span className="remote-device-section__title">
          <MonitorUp size={15} strokeWidth={2.1} aria-hidden="true" />
          <span>{t("SSH devices")}</span>
          <small>{t("Apply saved Profiles to Agents on Linux devices.")}</small>
        </span>
        <span className="remote-device-section__actions">
          <IconButton
            label={t("Check SSH connections")}
            disabled={busy}
            onClick={() => void onRefresh()}
          >
            <RefreshCw className={busy ? "is-spinning" : undefined} size={15} />
          </IconButton>
          <Button
            size="compact"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={busy}
            onClick={(event) => startAdd(event.currentTarget)}
          >
            {t("Add SSH device")}
          </Button>
        </span>
      </header>

      {devices.length > 0 ? (
        <div className="remote-device-list">
          {devices.map((device) => {
            const deviceEndpoints = endpointsByDevice.get(device.id) ?? [];
            return (
              <div className="remote-device-row" key={device.id}>
                <span className="remote-device-row__identity">
                  <strong>{device.name}</strong>
                  <small>{device.user ? `${device.user}@${device.host}` : device.host}{device.port ? `:${device.port}` : ""}</small>
                </span>
                <span className="remote-device-row__agents">
                  {deviceEndpoints.length > 0
                    ? deviceEndpoints.map((endpoint) => endpoint.agentName).join(" · ")
                    : busy ? t("Connecting") : t("No supported Agents detected")}
                </span>
                <span className="remote-device-row__actions">
                  <IconButton
                    label={t("Edit {{name}}", { name: device.name })}
                    disabled={busy}
                    onClick={(event) => startEdit(device, event.currentTarget)}
                  >
                    <Pencil size={14} />
                  </IconButton>
                  <IconButton
                    label={t("Remove {{name}}", { name: device.name })}
                    disabled={busy}
                    onClick={(event) => startRemove(device, event.currentTarget)}
                  >
                    <Trash2 size={14} />
                  </IconButton>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="remote-device-section__empty">
          {t("No SSH devices. Local Agents continue to work as before.")}
        </p>
      )}

      {editingId ? (
        <ModalFrame
          ariaLabel={editorTitle}
          className="remote-device-dialog ui-dialog-shell"
          dialogRef={dialogRef}
          dismissPolicy="intentional"
          dismissDisabled={busy}
          onDismiss={close}
        >
          <DialogHeader
            title={editorTitle}
            description={t("Uses system OpenSSH, SSH config, known_hosts, and your SSH Agent. Passwords and private keys are never stored.")}
          />
          <DialogBody className="remote-device-dialog__form">
            <TextField
              ref={nameRef}
              label={t("Device name")}
              value={form.name}
              placeholder={t("Build server")}
              disabled={busy}
              onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))}
            />
            <TextField
              label={t("SSH host")}
              value={form.host}
              placeholder={t("Host, address, or SSH config alias")}
              disabled={busy}
              onChange={(event) => setForm((current) => ({ ...current, host: event.currentTarget.value }))}
            />
            <div className="remote-device-dialog__optional">
              <TextField
                label={t("User")}
                value={form.user ?? ""}
                disabled={busy}
                onChange={(event) => setForm((current) => ({ ...current, user: event.currentTarget.value || undefined }))}
              />
              <TextField
                label={t("Port")}
                type="number"
                min={1}
                max={65535}
                value={form.port ?? ""}
                disabled={busy}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  port: event.currentTarget.value ? Number(event.currentTarget.value) : undefined
                }))}
              />
            </div>
            {error ? <p className="ui-field__error" role="alert">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button disabled={busy} onClick={close}>{t("Cancel")}</Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={busy || !form.name.trim() || !form.host.trim()}
              onClick={() => void submit()}
            >
              {busy ? t("Connecting") : editingId === "new" ? t("Add device") : t("Save")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
      {removingDevice ? (
        <ModalFrame
          ariaLabel={t("Remove SSH device")}
          className="remote-device-dialog ui-dialog-shell"
          dialogRef={dialogRef}
          dismissPolicy="intentional"
          dismissDisabled={busy}
          onDismiss={close}
        >
          <DialogHeader
            title={t("Remove {{name}}?", { name: removingDevice.name })}
            description={t("This removes the saved connection only. Files on the Linux device are not changed.")}
          />
          {error ? <DialogBody><p className="ui-field__error" role="alert">{error}</p></DialogBody> : null}
          <DialogFooter>
            <Button disabled={busy} onClick={close}>{t("Cancel")}</Button>
            <Button
              variant="danger"
              busy={busy}
              disabled={busy}
              onClick={() => void onRemove(removingDevice.id).then(close).catch((unknownError) => {
                setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
              })}
            >
              {t("Remove device")}
            </Button>
          </DialogFooter>
        </ModalFrame>
      ) : null}
    </section>
  );
};
