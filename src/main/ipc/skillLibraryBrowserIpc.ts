import type { SettingsStore } from "../settingsStore";
import type { SkillLibraryStore } from "../skillLibraryStore";
import { createSkillFileBrowser } from "../skillFileBrowser";
import type { AgentEnvPaths } from "../paths";
import { SafeIdSchema } from "../../shared/schemas";
import type { IpcRegistrationHandles } from "./registration";

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
  }
) => {
  const browser = createSkillFileBrowser(services.paths, services.settingsStore);
  diagnosticHandle("skills:list-library", () => services.skillLibraryStore.listSkills());
  diagnosticHandle("skills:list-files", (_event, id: unknown) => browser.list(parseSkillId(id)));
  diagnosticHandle("skills:read-file", (_event, input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid Skill file selection");
    const candidate = input as { id?: unknown; path?: unknown };
    if (typeof candidate.path !== "string") throw new Error("Invalid Skill file path");
    return browser.read(parseSkillId(candidate.id), candidate.path);
  });
};
