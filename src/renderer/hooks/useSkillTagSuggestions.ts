import { useEffect, useRef, useState } from "react";
import type { SkillLibraryEntry, SkillTagsInput } from "../../shared/types";
import type { SkillTagAnalysis, SkillTagSuggestion } from "../../shared/skillTagSuggestions";
import type { SkillSummaryConfig } from "../../shared/skillSummaries";
import { parseSkillTags, skillTagKey } from "../../shared/skillTags";
import { useI18n } from "../i18n";
import { useAIPreferences } from "./useAIPreferences";

export interface TagReviewRow {
  analysis?: SkillTagAnalysis;
  record?: SkillTagSuggestion;
  draft: string[];
  error?: string;
  status: "idle" | "running" | "ready" | "skipped" | "saved" | "error";
}
export const useSkillTagSuggestions = (skills: SkillLibraryEntry[], onSave: (input: SkillTagsInput) => Promise<boolean>) => {
  const { locale, t } = useI18n();
  const [rows, setRows] = useState<Record<string, TagReviewRow>>({});
  const [selected, setSelected] = useState(new Set(skills.filter((skill) => skills.length === 1 || !skill.tags?.length).map((skill) => skill.id)));
  const [busy, setBusy] = useState<"loading" | "preparing" | "generating" | "saving" | undefined>("loading");
  const [error, setError] = useState("");
  const active = useRef(true);
  const stopped = useRef(false);
  const ai = useAIPreferences();
  const requestId = useRef("");
  const patch = (id: string, values: Partial<TagReviewRow>) => {
    if (active.current) setRows((current) => ({ ...current, [id]: { ...(current[id] ?? { draft: [], status: "idle" }), ...values } }));
  };
  const load = async (ids: string[]) => {
    const result = await window.agentEnv.prepareSkillTagSuggestions(ids, locale);
    if (!active.current) return result;
    for (const item of result.items) {
      setRows((current) => {
        const prior = current[item.skillId];
        const changed = prior?.analysis?.key !== item.key;
        return { ...current, [item.skillId]: { ...(prior ?? { draft: [], status: "idle" }), analysis: item, error: undefined,
          ...(changed ? { record: item.cached, draft: item.cached?.tags.map((tag) => tag.tag) ?? [], status: item.cached ? "ready" : "idle" } : {}) } };
      });
    }
    for (const issue of result.errors) patch(issue.skillId, { error: issue.message, status: "error" });
    return result;
  };
  useEffect(() => {
    active.current = true;
    void load(skills.map((skill) => skill.id)).catch((error) => { if (active.current) setError(String(error)); })
      .finally(() => { if (active.current) setBusy(undefined); });
    return () => {
      active.current = false; stopped.current = true;
      if (requestId.current) void window.agentEnv.cancelSkillTagSuggestions(requestId.current);
    };
  }, []);
  const prepare = async (ids = [...selected], regenerate = false) => {
    if (busy || !ai.enabled("tags") || !ids.length) return;
    stopped.current = false;
    setBusy("preparing"); setError("");
    try {
      const result = await load(ids);
      const items = result.items.filter((item) => regenerate || !item.cached);
      if (!items.length || !active.current) return;
      const config = await window.agentEnv.readSkillSummaryConfig();
      if (!config.model) throw new Error(t("Configure the AI service in Settings first."));
      if (active.current && !stopped.current) await generate({ config, items, regenerate });
    } catch (error) { if (active.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (active.current) setBusy(undefined); }
  };
  const stop = () => {
    stopped.current = true;
    if (requestId.current) void window.agentEnv.cancelSkillTagSuggestions(requestId.current);
  };
  const generate = async (pending: { config: SkillSummaryConfig; items: SkillTagAnalysis[]; regenerate: boolean }) => {
    setBusy("generating");
    for (const item of pending.items) {
      if (!active.current) break;
      if (stopped.current) { patch(item.skillId, { status: "skipped" }); continue; }
      const id = crypto.randomUUID(); requestId.current = id;
      patch(item.skillId, { status: "running", error: undefined });
      try {
        const record = await window.agentEnv.generateSkillTagSuggestions({ skillId: item.skillId, expectedKey: item.key,
          requestId: id, expectedEndpoint: pending.config.endpoint, expectedModel: pending.config.model, confirmed: true, locale, regenerate: pending.regenerate });
        patch(item.skillId, { record, draft: record.tags.map((item) => item.tag), status: "ready" });
      } catch (error) { patch(item.skillId, { status: stopped.current ? "skipped" : "error", error: String(error) }); }
      finally { requestId.current = ""; }
    }
    if (active.current) setBusy(undefined);
  };
  useEffect(() => { if (!ai.enabled("tags")) stop(); }, [ai.preferences]);
  const saveable = skills.filter((skill) => selected.has(skill.id) && rows[skill.id]?.record && rows[skill.id].status !== "saved" && rows[skill.id].draft.some((tag) => !skill.tags?.some((existing) => skillTagKey(existing) === skillTagKey(tag))));
  const save = async () => {
    if (busy || !saveable.length) return;
    setBusy("saving");
    for (const skill of saveable) {
      patch(skill.id, { status: "running", error: undefined });
      try {
        const row = rows[skill.id];
        parseSkillTags([...(skill.tags ?? []), ...row.draft]);
        if (!await onSave({ id: skill.id, tags: row.draft, suggestionKey: row.record!.key })) throw new Error(t("Tags could not be saved. Try again."));
        patch(skill.id, { status: "saved" });
      } catch (error) { patch(skill.id, { status: "error", error: error instanceof Error ? error.message : String(error) }); }
    }
    if (active.current) setBusy(undefined);
  };
  return { allowed: ai.enabled("tags"), rows, selected, setSelected, busy, error, prepare, stop, save,
    saveable, patch, savedCount: Object.values(rows).filter((row) => row.status === "saved").length };
};
