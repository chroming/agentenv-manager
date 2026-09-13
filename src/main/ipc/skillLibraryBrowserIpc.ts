import type { SettingsStore } from "../settingsStore";
import type { SkillLibraryStore } from "../skillLibraryStore";
import { createSkillFileBrowser } from "../skillFileBrowser";
import type { AgentEnvPaths } from "../paths";
import { SafeIdSchema } from "../../shared/schemas";
import type { IpcRegistrationHandles } from "./registration";
import type { RuntimeDiagnostics } from "../runtimeDiagnostics";
import type { SkillRuntimeIssue } from "../../shared/types";

const parseSkillId = (value: unknown) => {
  const parsed = SafeIdSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid skill id");
  return parsed.data;
};

export const registerSkillLibraryBrowserIpc = (
  { diagnosticHandle }: Pick<IpcRegistrationHandles, "diagnosticHandle">,
  services: {
    paths: AgentEnvPaths;
    settingsStore: SettingsStore;
    skillLibraryStore: SkillLibraryStore;
    diagnostics?: Pick<RuntimeDiagnostics, "record">;
  }
) => {
  const browser = createSkillFileBrowser(services.paths, services.settingsStore);
  diagnosticHandle("skills:list-library", async () => {
    let issues: SkillRuntimeIssue[] = [];
    const entries = await services.skillLibraryStore.listSkills((next) => { issues = next; });
    const unreadable = entries.filter((entry) => entry.readIssue);
    await services.diagnostics?.record("skills:list-library", "inventory-reviewed", {
      outcome: issues.length ? "partial" : "completed",
      context: { resourceCount: entries.length, errorCount: issues.length,
        issues: issues.slice(0, 100),
        unreadable: unreadable.slice(0, 100).map((entry) => ({ libraryId: entry.id, path: entry.path, reason: entry.readIssue })) }
    });
    if (!entries.length && issues.length) throw new Error(issues.map((issue) => issue.message).join("\n"));
    return entries;
  });
  diagnosticHandle("skills:list-files", (_event, id: unknown) => browser.list(parseSkillId(id)));
  diagnosticHandle("skills:read-file", (_event, input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid Skill file selection");
    const candidate = input as { id?: unknown; path?: unknown };
    if (typeof candidate.path !== "string") throw new Error("Invalid Skill file path");
    return browser.read(parseSkillId(candidate.id), candidate.path);
  });
};
