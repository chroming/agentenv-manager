import { useEffect, useRef, useState } from "react";
import { FolderPlus, Pause, Play, Settings2, Trash2, X } from "lucide-react";
import type { HistorySearchConfig, HistorySearchStatus } from "../../shared/conversationSearch";
import { useI18n } from "../i18n";
import { useModalDialog } from "../hooks/useModalDialog";
import { SettingsPreferenceRow } from "./SettingsPreferenceRow";
import { OverflowTooltip } from "./OverflowTooltip";
import { Button, ControlGroup, DialogBody, DialogFooter, DialogHeader, IconButton, ModalFrame, Notice, SelectControl, Switch, TextField } from "./ui";

export const HistorySearchSettings = ({ onChanged }: { onChanged?(): void }) => {
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
    setOpen(true); setBusy(true); setError(""); setDraft(undefined); setClearRemoved(true);
    try { const value = await window.agentEnv.conversationHistoryStatus(); setStatus(value); setDraft(value.config); }
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
  const sources = [...new Map([...(status?.availableSources ?? []), ...(draft?.sources ?? []).map((s) => ({ ...s,
    deviceName: status?.availableSources.find((v) => v.deviceId === s.deviceId)?.deviceName ?? s.deviceId,
    agentName: status?.availableSources.find((v) => v.agentId === s.agentId)?.agentName ?? s.agentId
  }))].map((s) => [s.id, s])).values()];
  return <>
    <Button icon={<Settings2 size={16} />} onClick={() => void show()}>{t("History sources")}</Button>
    {open ? <ModalFrame className="ui-dialog-shell" ariaLabel={t("History search")} dialogRef={dialogRef} onDismiss={() => setOpen(false)} dismissDisabled={busy}>
      <DialogHeader title={t("History search")} description={t("Selected histories are indexed on this device for search. Original files are never changed. No AI service is used.")}
        actions={<IconButton label={t("Close")} disabled={busy} onClick={() => setOpen(false)}><X size={16} /></IconButton>} />
      <DialogBody>
        {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
        {status?.settingsIssue ? <Notice tone="warning">{status.settingsIssue}</Notice> : null}
        {draft ? <>
          <SettingsPreferenceRow controlWidth="intrinsic" label={t("History search")} control={<Switch label={t("History search")} checked={draft.enabled}
            onClick={() => setDraft({ ...draft, enabled: !draft.enabled })} />} />
          {draft.enabled ? <>
            <SettingsPreferenceRow controlWidth="intrinsic" label={t("Background indexing")} help={t("Pause keeps existing results searchable.")}
              control={<Button icon={draft.paused ? <Play size={16} /> : <Pause size={16} />}
                onClick={() => setDraft({ ...draft, paused: !draft.paused })}>{t(draft.paused ? "Resume" : "Pause")}</Button>} />
            {sources.map((source) => {
              const selected = draft.sources.some((s) => s.id === source.id);
              const coverage = status?.sources.find((s) => s.sourceKey === source.id);
              const deviceName = source.deviceId === "local" ? t(source.deviceName) : source.deviceName;
              return <div key={source.id}>
                <SettingsPreferenceRow controlWidth="intrinsic" label={`${deviceName} · ${source.agentName}`}
                  description={<OverflowTooltip className="history-source-path" text={source.root} />}
                  control={<ControlGroup>
                    {source.kind === "directory" ? <IconButton label={t("Remove source")} onClick={() => {
                      setDraft({ ...draft, sources: draft.sources.filter((s) => s.id !== source.id) });
                    }}><Trash2 size={16} /></IconButton> : null}
                    <Switch label={`${deviceName} · ${source.agentName} · ${source.root}`} checked={selected}
                      onClick={() => setDraft({ ...draft, sources: selected ? draft.sources.filter((s) => s.id !== source.id) : [...draft.sources, { id: source.id, deviceId: source.deviceId, agentId: source.agentId, root: source.root, kind: source.kind }] })} />
                  </ControlGroup>} />
                {selected && coverage ? <details className="history-source-coverage">
                  <summary>{t(coverage.phase)} · {coverage.indexed}/{coverage.discovered} {t("indexed")}{coverage.summaryOnly ? ` · ${coverage.summaryOnly} ${t("Summary only")}` : ""}{coverage.failed ? ` · ${coverage.failed} ${t("failed")}` : ""}</summary>
                  <p>{t("Summary only")}: {coverage.summaryOnly} · {t("Last successful refresh")}: {coverage.lastSuccessAt ? new Date(coverage.lastSuccessAt).toLocaleString() : t("Not yet")}</p>
                  {coverage.issues.map((issue, i) => <p className="selectable" key={i}>{issue}</p>)}
                </details> : null}
              </div>;
            })}
            {extra ? <div className="history-extra-source">
              <SelectControl aria-label={t("History Agent and device")} value={baseId} onChange={(e) => setBaseId(e.currentTarget.value)}>
                <option value="">{t("Choose Agent and device")}</option>
                {status?.availableSources.map((s) => <option key={s.id} value={s.id}>{s.deviceName} · {s.agentName}</option>)}
              </SelectControl>
              <TextField label={t("History directory")} value={path} onChange={(e) => setPath(e.currentTarget.value)} />
              <Button disabled={!path.trim() || !baseId} onClick={() => {
                const base = status?.availableSources.find((s) => s.id === baseId);
                if (!base) return;
                setDraft({ ...draft, sources: [...draft.sources, { id: `extra-${Date.now()}`, deviceId: base.deviceId, agentId: base.agentId, root: path.trim(), kind: "directory" }] });
                setPath(""); setExtra(false);
              }}>{t("Add")}</Button>
            </div> : <Button icon={<FolderPlus size={16} />} onClick={() => setExtra(true)}>{t("Add history directory")}</Button>}
          </> : null}
          <SettingsPreferenceRow controlWidth="intrinsic" label={t("Clear index for disabled or removed sources")} help={t("Only this app's cached text and search index are removed, never original histories.")}
            control={<Switch label={t("Clear index for disabled or removed sources")} checked={clearRemoved} onClick={() => setClearRemoved(!clearRemoved)} />} />
        </> : null}
      </DialogBody>
      <DialogFooter><Button onClick={() => setOpen(false)} disabled={busy}>{t("Cancel")}</Button>
        <Button variant="primary" busy={busy} disabled={!draft || (draft.enabled && !draft.sources.length)} onClick={() => void save()}>{t("Save")}</Button></DialogFooter>
    </ModalFrame> : null}
  </>;
};
