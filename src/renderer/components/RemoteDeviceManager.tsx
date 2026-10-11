import { LoaderCircle, Server, Pencil, RefreshCw, Trash2, Settings2 } from "lucide-react";
import { AgentDeviceHeader } from "./AgentDeviceHeader";
import { DiagnosticMessage } from "./ui/DiagnosticCopyButton";
import { TargetEnvironmentSummary } from "./TargetEnvironmentSummary";
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import type {
  CreateRemoteDeviceInput,
  RemoteAgentEndpoint,
  RemoteDevice,
  RemoteDeviceProbe,
  SshConfigHost,
  SshConfigHostResolution,
  TargetInfo,
  TargetManagementState,
  UpdateRemoteDeviceInput
} from "../../shared/types";
import { useModalDialog } from "../hooks/useModalDialog";
import { useI18n } from "../i18n";
import { AgentEndpointIcon } from "./AgentEndpointIcon";
import { OverflowTooltip } from "./OverflowTooltip";
import {
  Button,
  ControlGroup,
  DialogBody,
  DialogFooter,
  DialogHeader,
  ModalFrame,
  IconButton,
  SelectField,
  TextAction,
  ToolbarOverflowMenu,
  TextField,
  AlignedResourceList, ResourceRow, ChoiceInput
} from "./ui";

interface RemoteDeviceManagerProps {
  devices: RemoteDevice[];
  endpoints: RemoteAgentEndpoint[];
  probes: RemoteDeviceProbe[];
  remoteTargets: TargetInfo[];
  targetStates: TargetManagementState[];
  busy: boolean;
  busyDeviceIds: string[];
  onAdd(input: CreateRemoteDeviceInput): Promise<{
    device: RemoteDevice;
    probe?: RemoteDeviceProbe;
  } | void>;
  onListSshConfigHosts(): Promise<SshConfigHost[]>;
  onResolveSshConfigHost(alias: string): Promise<SshConfigHostResolution>;
  onUpdate(input: UpdateRemoteDeviceInput): Promise<{
    device: RemoteDevice;
    probe?: RemoteDeviceProbe;
  } | void>;
  onRemove(id: string): Promise<void>;
  onRefreshDevice(id: string): Promise<void>;
  onOpenProfile(targetId: string): void;
}

export interface RemoteDeviceManagerHandle {
  openAdd(trigger: HTMLElement): void;
}

const EMPTY_FORM: CreateRemoteDeviceInput = { name: "", host: "" };
const MANUAL_HOST = "__manual__";

const remoteLifecycleLabel = (
  status: TargetManagementState["lifecycleStatus"] | undefined,
  t: (message: string) => string
) => {
  switch (status) {
    case "applied":
      return t("Applied");
    case "applied-with-local-override":
      return t("Local overrides");
    case "pending":
      return t("Changes pending");
    case "drifted":
      return t("Changed outside AgentEnv");
    case "recovery-required":
      return t("Recovery required");
    default:
      return t("Not managed");
  }
};

export const RemoteDeviceManager = forwardRef<RemoteDeviceManagerHandle, RemoteDeviceManagerProps>(({
  devices,
  endpoints,
  probes,
  remoteTargets,
  targetStates,
  busy,
  busyDeviceIds,
  onAdd,
  onListSshConfigHosts,
  onResolveSshConfigHost,
  onUpdate,
  onRemove,
  onRefreshDevice,
  onOpenProfile
}, forwardedRef) => {
  const { localeTag, t } = useI18n();
  const [editingId, setEditingId] = useState<string>();
  const [choosingId, setChoosingId] = useState<string>();
  const [disabledAgents, setDisabledAgents] = useState<string[]>([]);
  const [removingId, setRemovingId] = useState<string>();
  const [form, setForm] = useState<CreateRemoteDeviceInput>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [connectionIssue, setConnectionIssue] = useState(false);
  const [sshConfigHosts, setSshConfigHosts] = useState<SshConfigHost[]>([]);
  const [sshConfigState, setSshConfigState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [selectedSshHost, setSelectedSshHost] = useState("");
  const [resolvedSshHost, setResolvedSshHost] = useState<SshConfigHostResolution>();
  const [resolvingSshHost, setResolvingSshHost] = useState(false);
  const [sshResolutionError, setSshResolutionError] = useState(false);
  const sshConfigRequestRef = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const open = editingId !== undefined || removingId !== undefined || choosingId !== undefined;
  const choosingDevice = devices.find((device) => device.id === choosingId);
  const removingDevice = devices.find((device) => device.id === removingId);
  const editorTitle = editingId === "new" ? t("Add SSH device") : t("Edit SSH device");
  const endpointsByDevice = useMemo(() => {
    const result = new Map<string, RemoteAgentEndpoint[]>();
    for (const endpoint of endpoints) {
      result.set(endpoint.deviceId, [...(result.get(endpoint.deviceId) ?? []), endpoint]);
    }
    return result;
  }, [endpoints]);
  const probesByDevice = useMemo(() => new Map(
    probes.map((probe) => [probe.deviceId, probe])
  ), [probes]);
  const targetsById = useMemo(() => new Map(
    remoteTargets.map((target) => [target.id, target])
  ), [remoteTargets]);
  const statesByTarget = useMemo(() => new Map(
    targetStates.map((state) => [state.targetId, state])
  ), [targetStates]);

  const close = () => {
    if (busy) return;
    sshConfigRequestRef.current += 1;
    setEditingId(undefined);
    setChoosingId(undefined);
    setRemovingId(undefined);
    setForm(EMPTY_FORM);
    setError("");
    setConnectionIssue(false);
    setSshConfigHosts([]);
    setSshConfigState("idle");
    setSelectedSshHost("");
    setResolvedSshHost(undefined);
    setResolvingSshHost(false);
    setSshResolutionError(false);
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
    setConnectionIssue(false);
    setEditingId("new");
    setSshConfigHosts([]);
    setSelectedSshHost("");
    setResolvedSshHost(undefined);
    setResolvingSshHost(false);
    setSshResolutionError(false);
    setSshConfigState("loading");
    const requestId = ++sshConfigRequestRef.current;
    void onListSshConfigHosts().then((hosts) => {
      if (requestId !== sshConfigRequestRef.current) return;
      setSshConfigHosts(hosts);
      setSshConfigState("ready");
      if (hosts.length === 0) setSelectedSshHost(MANUAL_HOST);
    }).catch(() => {
      if (requestId !== sshConfigRequestRef.current) return;
      setSshConfigState("error");
      setSelectedSshHost(MANUAL_HOST);
    });
  };

  useImperativeHandle(forwardedRef, () => ({ openAdd: startAdd }));

  const startEdit = (device: RemoteDevice, element: HTMLElement) => {
    sshConfigRequestRef.current += 1;
    returnFocusRef.current = element;
    setForm({
      name: device.name,
      host: device.host,
      user: device.user,
      port: device.port
    });
    setError("");
    setConnectionIssue(false);
    setSshConfigState("idle");
    setSelectedSshHost("");
    setResolvedSshHost(undefined);
    setSshResolutionError(false);
    setEditingId(device.id);
  };

  const startRemove = (device: RemoteDevice, element: HTMLElement) => {
    sshConfigRequestRef.current += 1;
    returnFocusRef.current = element;
    setError("");
    setConnectionIssue(false);
    setEditingId(undefined);
    setRemovingId(device.id);
  };

  const selectSshHost = (value: string) => {
    const previousSelection = selectedSshHost;
    const requestId = ++sshConfigRequestRef.current;
    setSelectedSshHost(value);
    setResolvedSshHost(undefined);
    setResolvingSshHost(false);
    setSshResolutionError(false);
    if (!value || value === MANUAL_HOST) {
      setForm((current) => ({
        ...current,
        name: current.name === previousSelection ? "" : current.name,
        host: "",
        user: undefined,
        port: undefined
      }));
      return;
    }
    setForm((current) => ({
      name: !current.name.trim() || sshConfigHosts.some((host) => host.alias === current.name)
        ? value
        : current.name,
      host: value
    }));
    setResolvingSshHost(true);
    void onResolveSshConfigHost(value).then((resolution) => {
      if (requestId !== sshConfigRequestRef.current) return;
      setResolvedSshHost(resolution);
      setResolvingSshHost(false);
    }).catch(() => {
      if (requestId !== sshConfigRequestRef.current) return;
      setResolvingSshHost(false);
      setSshResolutionError(true);
    });
  };

  const isAdding = editingId === "new";
  const showSshConfigPicker = isAdding && (
    sshConfigState === "loading" || sshConfigHosts.length > 0
  );
  const showManualConnection = !isAdding || (
    sshConfigState !== "loading" && (!sshConfigHosts.length || selectedSshHost === MANUAL_HOST)
  );
  const resolvedEndpoint = resolvedSshHost
    ? `${resolvedSshHost.user ? `${resolvedSshHost.user}@` : ""}${resolvedSshHost.hostName}${resolvedSshHost.port ? `:${resolvedSshHost.port}` : ""}`
    : undefined;

  const submit = async () => {
    try {
      setError("");
      setConnectionIssue(false);
      const result = editingId === "new"
        ? await onAdd(form)
        : editingId
          ? await onUpdate({ id: editingId, ...form })
          : undefined;
      if (result?.probe && result.probe.status !== "ready") {
        setEditingId(result.device.id);
        setConnectionIssue(true);
        setError(t("Device saved, but AgentEnv could not connect: {{error}}", {
          error: result.probe.error ?? t("Connection unavailable")
        }));
        return;
      }
      setEditingId(undefined);
      setForm(EMPTY_FORM);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError));
    }
  };

  const formatCheckedAt = (value?: string) => value
    ? new Intl.DateTimeFormat(localeTag, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(value))
    : "";

  return (
    <>
      {devices.map((device) => {
        const allDeviceEndpoints = endpointsByDevice.get(device.id) ?? [];
        const deviceEndpoints = allDeviceEndpoints.filter((endpoint) => !device.disabledAgentIds?.includes(endpoint.agentId));
        const probe = probesByDevice.get(device.id);
        const status = probe?.status ?? "unavailable";
        const checking = busyDeviceIds.includes(device.id);
        const statusText = checking
          ? t("Checking")
          : status === "ready"
            ? deviceEndpoints.length > 0
              ? t(deviceEndpoints.length === 1 ? "{{count}} Agent" : "{{count}} Agents", {
                  count: deviceEndpoints.length
                })
              : allDeviceEndpoints.length > 0 ? t("No Agents selected") : t("No supported Agents")
            : status === "unsupported"
              ? t("Unsupported")
              : t("Offline");
        return (
          <section className={`remote-location-group is-${status}`} key={device.id}>
            <AgentDeviceHeader icon={<Server size={15} />} name={device.name}
              detail={`${device.user ? `${device.user}@` : ""}${device.host}${device.port ? `:${device.port}` : ""}`}
              status={<span
                className={`remote-location-header__status is-${status}`}
                title={probe?.checkedAt
                  ? t("Checked {{time}}", { time: formatCheckedAt(probe.checkedAt) })
                  : undefined}
              >
                {checking ? <LoaderCircle className="is-spinning" size={13} aria-hidden="true" /> : null}
                <span>{statusText}</span>
              </span>} actions={<>
                <IconButton label={t("Choose Agents on {{device}}", { device: device.name })} size="compact" variant="ghost" disabled={busy}
                  onClick={(event) => { returnFocusRef.current = event.currentTarget; setError(""); setDisabledAgents(device.disabledAgentIds ?? []); setChoosingId(device.id); }}><Settings2 size={15} /></IconButton>
                <IconButton
                  disabled={busy || checking}
                  label={t("Refresh {{name}}", { name: device.name })}
                  size="compact"
                  variant="ghost"
                  onClick={() => void onRefreshDevice(device.id)}
                >
                  <RefreshCw className={checking ? "is-spinning" : ""} size={14} aria-hidden="true" />
                </IconButton>
                <ToolbarOverflowMenu
                  disabled={busy || checking}
                  items={[
                    {
                      id: "edit",
                      icon: <Pencil size={14} />,
                      label: t("Edit"),
                      onSelect: (trigger) => startEdit(device, trigger)
                    },
                    {
                      id: "remove",
                      icon: <Trash2 size={14} />,
                      label: t("Remove"),
                      onSelect: (trigger) => startRemove(device, trigger)
                    }
                  ]}
                  label={t("More actions for {{name}}", { name: device.name })}
                  menuLabel={t("Actions for {{name}}", { name: device.name })}
                />
              </>} />
            {!checking && probe?.error ? (
              <div className="remote-location-error" role="status">
                <OverflowTooltip className="remote-location-error__message" text={probe.error} />
                <Button size="compact" variant="ghost" onClick={() => void onRefreshDevice(device.id)}>
                  {t("Retry")}
                </Button>
              </div>
            ) : null}
            {deviceEndpoints.length > 0 ? deviceEndpoints.map((endpoint) => {
              const target = targetsById.get(endpoint.id);
              const state = statesByTarget.get(endpoint.id);
              if (!target) return null;
              const available = endpoint.availability === "ready";
              return (
                <article className="target-card target-card--workflow remote-agent-row" key={endpoint.id}>
                  <header className="target-workflow-header">
                    <span className="target-workflow-icon remote-agent-row__icon" aria-hidden="true">
                      <AgentEndpointIcon target={target} size={20} />
                    </span>
                    <span className="target-workflow-title">
                      <span className="target-workflow-name-line">
                        <TextAction
                          className="target-workflow-name-action"
                          onClick={() => onOpenProfile(endpoint.id)}
                        >
                          <strong>{endpoint.agentName}</strong>
                        </TextAction>
                        <span className={`target-health-status target-health-status--${available ? "ready" : "unknown"}`} title={t(available ? "Ready" : "Unavailable")}>
                          <span className={available ? "ui-visually-hidden" : undefined}>{t(available ? "Ready" : "Unavailable")}</span>
                        </span>
                      </span>
                    </span>
                    <span title={state?.lastAppliedAt ? `${t("Last applied")} · ${formatCheckedAt(state.lastAppliedAt)}` : undefined}>
                    <TargetEnvironmentSummary
                      lifecycleStatus={state?.lifecycleStatus}
                      lifecycle={state?.lifecycleStatus ? remoteLifecycleLabel(state.lifecycleStatus, t) : t("Not managed")}
                      profileName={state?.activeProfileName}
                      emptyLabel={t("Not configured")}
                    />
                    </span>
                    <span className="remote-agent-row__action" />
                  </header>
                </article>
              );
            }) : (
              <div className="remote-location-empty">
                {allDeviceEndpoints.length > 0 ? t("No Agents selected") : status === "ready" ? t("No supported Agents installed") : t("Previously detected Agents will remain visible after a successful connection.")}
              </div>
            )}
          </section>
        );
      })}

      {choosingDevice ? <ModalFrame ariaLabel={t("Choose Agents on {{device}}", { device: choosingDevice.name })}
        className="remote-device-dialog ui-dialog-shell" dialogRef={dialogRef} dismissPolicy="intentional" dismissDisabled={busy} onDismiss={close}>
        <DialogHeader title={t("Choose Agents on {{device}}", { device: choosingDevice.name })}
          description={t("Choose which Agents to use in AgentEnv. Existing deployments and remote files are not changed.")} />
        <DialogBody>
          <AlignedResourceList actionTrack="compact">
            {(endpointsByDevice.get(choosingDevice.id) ?? []).map((endpoint) => <ResourceRow key={endpoint.id} title={endpoint.agentName} icon={<AgentEndpointIcon target={{ id: endpoint.agentId, name: endpoint.agentName }} size={20} />} density="compact" appearance="plain"
              actions={<ChoiceInput type="checkbox" aria-label={endpoint.agentName} disabled={busy} checked={!disabledAgents.includes(endpoint.agentId)}
                onChange={(event) => setDisabledAgents((current) => event.target.checked ? current.filter((id) => id !== endpoint.agentId) : [...new Set([...current, endpoint.agentId])])} /> } />)}
          </AlignedResourceList>
          {(endpointsByDevice.get(choosingDevice.id) ?? []).length === 0 ? <p>{t("No supported Agents installed")}</p> : null}
          {error ? <p className="ui-field__error" role="alert"><DiagnosticMessage message={error} /></p> : null}
        </DialogBody>
        <DialogFooter><Button disabled={busy} onClick={close}>{t("Cancel")}</Button>
          <Button variant="primary" busy={busy} disabled={busy} onClick={() => void onUpdate({ ...choosingDevice, disabledAgentIds: disabledAgents }).then(close).catch((cause) => setError(String(cause)))}>{t("Save")}</Button>
        </DialogFooter>
      </ModalFrame> : null}
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
            {showSshConfigPicker ? (
              <SelectField
                label={t("SSH config host")}
                aria-label={t("SSH config host")}
                value={sshConfigState === "loading" ? "" : selectedSshHost}
                disabled={busy || sshConfigState === "loading"}
                description={resolvingSshHost
                  ? t("Reading SSH settings...")
                  : resolvedEndpoint
                    ? t("Connects to {{endpoint}} using this SSH config alias.", { endpoint: resolvedEndpoint })
                    : sshResolutionError
                      ? t("Could not preview this Host. System SSH will still use the saved alias.")
                    : t("Choose a named Host from ~/.ssh/config, or enter one manually.")}
                onChange={(event) => selectSshHost(event.currentTarget.value)}
              >
                <option value="">
                  {sshConfigState === "loading" ? t("Reading SSH config...") : t("Choose a host")}
                </option>
                {sshConfigHosts.map((host) => (
                  <option value={host.alias} key={host.alias}>{host.alias}</option>
                ))}
                <option value={MANUAL_HOST}>{t("Enter manually")}</option>
              </SelectField>
            ) : null}
            <TextField
              ref={nameRef}
              label={t("Device name")}
              value={form.name}
              placeholder={t("Build server")}
              disabled={busy}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setForm((current) => ({ ...current, name }));
              }}
            />
            {showManualConnection ? (
              <TextField
                label={t("SSH host")}
                value={form.host}
                placeholder={t("Host, address, or SSH config alias")}
                disabled={busy}
                description={sshConfigState === "error"
                  ? t("Named SSH hosts could not be read. You can still enter connection details manually.")
                  : undefined}
                onChange={(event) => {
                  const host = event.currentTarget.value;
                  setForm((current) => ({ ...current, host }));
                }}
              />
            ) : null}
            {showManualConnection ? (
              <div className="remote-device-dialog__optional">
                <TextField
                  label={t("User")}
                  value={form.user ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const user = event.currentTarget.value || undefined;
                    setForm((current) => ({ ...current, user }));
                  }}
                />
                <TextField
                  label={t("Port")}
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const port = event.currentTarget.value ? Number(event.currentTarget.value) : undefined;
                    setForm((current) => ({ ...current, port }));
                  }}
                />
              </div>
            ) : null}
            {error ? <p className="ui-field__error" role="alert"><DiagnosticMessage message={error} /></p> : null}
          </DialogBody>
          <DialogFooter>
            <Button disabled={busy} onClick={close}>{t(connectionIssue ? "Close" : "Cancel")}</Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={busy || sshConfigState === "loading" || !form.name.trim() || !form.host.trim()}
              onClick={() => void submit()}
            >
              {busy
                ? t("Connecting")
                : connectionIssue
                  ? t("Retry")
                  : editingId === "new"
                    ? t("Add device")
                    : t("Save")}
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
            description={t("This removes the saved connection and local status history. Files on the Linux device are not changed.")}
          />
          {error ? <DialogBody><p className="ui-field__error" role="alert"><DiagnosticMessage message={error} /></p></DialogBody> : null}
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
    </>
  );
});

RemoteDeviceManager.displayName = "RemoteDeviceManager";
