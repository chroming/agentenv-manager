import { useEffect, useRef, useState } from "react";
import { Check, FolderPlus, Info, Monitor, Server, Settings2, Trash2, TriangleAlert, X } from "lucide-react";
import type { HistorySearchConfig, HistorySearchStatus } from "../../shared/conversationSearch";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { OverflowTooltip } from "./OverflowTooltip";
import { Button, ControlGroup, DialogBody, DialogFooter, DialogHeader, IconButton, ModalFrame, Notice, SelectControl, Switch, TextField, ToolbarOverflowMenu } from "./ui";

export const HistorySearchSettings = ({ onChanged, entry = "settings" }: { onChanged?(): void; entry?: "settings" | "setup" | "icon" }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<HistorySearchStatus>();
  const [draft, setDraft] = useState<HistorySearchConfig>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clearRemoved, setClearRemoved] = useState(true);
  const [extra, setExtra] = useState(false);
  const [baseId, setBaseId] = useState("");
  const [path, setPath] = useState("");
  const [details, setDetails] = useState<string[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog({ open, dialogRef, onDismiss: () => setOpen(false), dismissDisabled: busy });
  useEffect(() => {
    if (!open) return;
    let active = true;
    const read = () => window.agentEnv.conversationHistoryStatus().then((value) => {
      if (active) setStatus(value);
    }).catch((e) => { if (active) setError(String(e)); });
    const timer = window.setInterval(() => void read(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [open]);
  const show = async () => {
    setOpen(true); setBusy(true); setError(""); setDraft(undefined); setClearRemoved(true); setDetails([]); setExtra(false); setRemovedIds([]);
    try { const value = await window.agentEnv.conversationHistoryStatus(); setStatus(value); setDraft({ ...value.config, enabled: true, paused: value.config.enabled && value.config.paused }); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError("");
    try {
      await window.agentEnv.configureConversationHistory(draft, clearRemoved);
      window.dispatchEvent(new Event("agentenv-history-changed"));
      onChanged?.(); setOpen(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const sources = [...new Map([...(status?.availableSources ?? []), ...[...(status?.config.sources ?? []), ...(draft?.sources ?? [])].map((s) => ({ ...s,
    deviceName: status?.availableSources.find((v) => v.deviceId === s.deviceId)?.deviceName ?? s.deviceId,
    agentName: status?.availableSources.find((v) => v.agentId === s.agentId)?.agentName ?? s.agentId
  }))].map((s) => [s.id, s])).values()].filter((source) => !removedIds.includes(source.id));
  const devices = [...new Set(sources.map((source) => source.deviceId))];
  const firstSetup = !status?.config.enabled;
  const entryLabel = entry === "setup" ? t("Choose devices") : t("History sources");
  const removesCachedSources = Boolean(status?.config.sources.length && draft && (!draft.enabled || status.config.sources.some((source) => !draft.sources.some((selected) => selected.id === source.id))));
  const toggleSources = (ids: string[], enabled: boolean) => {
    if (!draft) return;
    setDraft({ ...draft, sources: [
      ...draft.sources.filter((source) => !ids.includes(source.id)),
      ...(enabled ? sources.filter((source) => ids.includes(source.id)).map(({ deviceName, agentName, ...source }) => source) : [])
    ] });
  };
  return <>
    {entry === "icon" ? <IconButton label={t("History sources")} onClick={() => void show()}><Settings2 size={16} /></IconButton> : <Button variant={entry === "setup" ? "primary" : "secondary"} icon={<Settings2 size={16} />} onClick={() => void show()}>{entryLabel}</Button>}
    {open ? <ModalFrame className="ui-dialog-shell" ariaLabel={t("History search")} dialogRef={dialogRef} onDismiss={() => setOpen(false)} dismissDisabled={busy}>
      <DialogHeader title={t("History sources")}
        actions={<IconButton label={t("Close")} disabled={busy} onClick={() => setOpen(false)}><X size={16} /></IconButton>} />
      <DialogBody>
        {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
        {status?.settingsIssue ? <Notice tone="warning">{status.settingsIssue}</Notice> : null}
        {draft ? <>
          {!firstSetup ? <SettingsPreferenceRow controlWidth="intrinsic" label={t("History search")} control={<Switch label={t("History search")} checked={draft.enabled}
            onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} />} />
          : null}
          {draft.enabled ? <>
            {devices.map((deviceId) => {
              const deviceSources = sources.filter((source) => source.deviceId === deviceId);
              const deviceName = deviceId === "local" ? t(deviceSources[0].deviceName) : deviceSources[0].deviceName;
              const enabled = deviceSources.some((source) => draft.sources.some((selected) => selected.id === source.id));
              const agents = [...new Set(deviceSources.map((source) => source.agentId))];
              const needsAttention = status?.sources.some((coverage) => deviceSources.some((source) => source.id === coverage.sourceKey && draft.sources.some((selected) => selected.id === source.id)) && (coverage.phase === "partial" || coverage.phase === "unavailable"));
              return <div key={deviceId}>
                <SettingsPreferenceRow controlWidth="intrinsic" label={<span className="history-device-label">{deviceId === "local" ? <Monitor size={16} /> : <Server size={16} />}{deviceName}</span>} control={<ControlGroup>
                  {needsAttention ? <IconButton label={`${deviceName} · ${t("Needs attention")}`} onClick={() => setDetails((current) => current.includes(deviceId) ? current : [...current, deviceId])}><TriangleAlert size={16} /></IconButton> : null}
                  <ToolbarOverflowMenu label={`${deviceName} · ${t("More")}`} menuLabel={deviceName} items={[
                    ...agents.map((agentId) => {
                      const items = deviceSources.filter((source) => source.agentId === agentId);
                      const checked = items.some((source) => draft.sources.some((selected) => selected.id === source.id));
                      return { id: agentId, label: items[0].agentName, checked,
                        icon: <Check size={16} style={{ visibility: checked ? "visible" : "hidden" }} />,
                        onSelect: () => toggleSources(items.map((source) => source.id), !checked) };
                    }),
                    { id: "directory", label: t("Add history directory"), icon: <FolderPlus size={16} />, onSelect: () => { setBaseId(deviceSources[0].id); setExtra(true); } },
                    { id: "details", label: t("Details"), icon: <Info size={16} />, onSelect: () => setDetails((current) => current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId]) }
                  ]} />
                  <Switch label={deviceName} checked={enabled} onClick={() => toggleSources(deviceSources.map((source) => source.id), !enabled)} />
                </ControlGroup>} />
                {details.includes(deviceId) ? deviceSources.map((source) => {
              const selected = draft.sources.some((s) => s.id === source.id);
              const coverage = status?.sources.find((s) => s.sourceKey === source.id);
              return <div key={source.id}>
                <SettingsPreferenceRow controlWidth="intrinsic" label={source.agentName}
                  description={<OverflowTooltip className="history-source-path" text={source.root} />}
                  control={<ControlGroup>
                    {source.kind === "directory" ? <IconButton label={t("Remove source")} onClick={() => {
                      setRemovedIds((current) => [...current, source.id]);
                      setDraft({ ...draft, sources: draft.sources.filter((s) => s.id !== source.id) });
                    }}><Trash2 size={16} /></IconButton> : null}
                  </ControlGroup>} />
                {selected && coverage ? <div className="history-source-coverage">
                  <p>{t(coverage.phase)} · {coverage.indexed}/{coverage.discovered} {t("indexed")}{coverage.summaryOnly ? ` · ${coverage.summaryOnly} ${t("Summary only")}` : ""}{coverage.failed ? ` · ${coverage.failed} ${t("failed")}` : ""}</p>
                  <p>{t("Summary only")}: {coverage.summaryOnly} · {t("Last successful refresh")}: {coverage.lastSuccessAt ? new Date(coverage.lastSuccessAt).toLocaleString() : t("Not yet")}</p>
                  {coverage.issues.map((issue, i) => <p className="selectable" key={i}>{issue}</p>)}
                </div> : null}
              </div>;
                }) : null}
              </div>;
            })}
            {extra ? <div className="history-extra-source">
              <SelectControl aria-label={t("History Agent and device")} value={baseId} onChange={(e) => setBaseId(e.currentTarget.value)}>
                <option value="">{t("Choose Agent and device")}</option>
                {status?.availableSources.filter((s) => s.deviceId === sources.find((source) => source.id === baseId)?.deviceId).map((s) => <option key={s.id} value={s.id}>{s.agentName}</option>)}
              </SelectControl>
              <TextField label={t("History directory")} value={path} onChange={(e) => setPath(e.currentTarget.value)} />
              <Button disabled={!path.trim() || !baseId} onClick={() => {
                const base = status?.availableSources.find((s) => s.id === baseId);
                if (!base) return;
                setDraft({ ...draft, sources: [...draft.sources, { id: `extra-${Date.now()}`, deviceId: base.deviceId, agentId: base.agentId, root: path.trim(), kind: "directory" }] });
                setPath(""); setExtra(false);
              }}>{t("Add")}</Button>
              <IconButton label={t("Cancel")} onClick={() => setExtra(false)}><X size={16} /></IconButton>
            </div> : null}
          </> : null}
          {removesCachedSources ? <SettingsPreferenceRow controlWidth="intrinsic" label={t("Clear index for disabled or removed sources")} help={t("Only this app's cached text and search index are removed, never original histories.")}
            control={<Switch label={t("Clear index for disabled or removed sources")} checked={clearRemoved} onClick={() => setClearRemoved(!clearRemoved)} />} /> : null}
          {firstSetup ? <p className="history-consent-note">{t("Histories are indexed locally. Original files are never changed.")}</p> : null}
        </> : null}
      </DialogBody>
      <DialogFooter><Button onClick={() => setOpen(false)} disabled={busy}>{t("Cancel")}</Button>
        <Button variant="primary" busy={busy} disabled={!draft || (draft.enabled && !draft.sources.length)} onClick={() => void save()}>{t(firstSetup ? "Enable search" : "Save")}</Button></DialogFooter>
    </ModalFrame> : null}
  </>;
};
