import { safeStorage } from "electron";
import { z } from "zod";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { IpcRegistrationHandles } from "./registration";
import { parseId } from "./registration";
import { isSecureTokenStorageAvailable } from "../githubAuthService";
import { createSummaryStore } from "../skillSummaries/summaryStore";
import { createSummaryService } from "../skillSummaries/summaryService";
import { createAIJsonClient } from "../ai/aiJsonClient";
import { createSkillTagSuggestionService } from "../ai/skillTagSuggestions";

export const registerSkillSummaryIpc = (
  { diagnosticHandle, handleMutation }: IpcRegistrationHandles,
  root: string,
  library: SkillLibraryStore
) => {
  const store = createSummaryStore(root, {
    encryptString: (value) => safeStorage.encryptString(value),
    decryptString: (value) => safeStorage.decryptString(value),
    isEncryptionAvailable: () => isSecureTokenStorageAvailable({
      encryptionAvailable: safeStorage.isEncryptionAvailable(), platform: process.platform,
      ...(process.platform === "linux" ? { backend: safeStorage.getSelectedStorageBackend() } : {})
    })
  });
  const request = createAIJsonClient();
  const service = createSummaryService({ store, readInput: library.readSummaryInput, request });
  const tags = createSkillTagSuggestionService({ root, library, configStore: store, request });
  diagnosticHandle("skill-tags:prepare", (_event, ids, locale) => tags.prepareBatch(z.array(z.string()).parse(ids), z.enum(["en", "zh_CN", "zh_TW"]).parse(locale)));
  diagnosticHandle("skill-tags:generate", (_event, input) => tags.generate(input));
  diagnosticHandle("skill-tags:cancel", (_event, id) => tags.cancel(z.string().uuid().parse(id)));
  handleMutation("skills:set-tags", (_event, raw) => {
    const input = z.object({ id: z.string(), tags: z.array(z.string()), suggestionKey: z.string().regex(/^[a-f0-9]{64}$/).optional() }).parse(raw);
    return input.suggestionKey ? tags.apply(input) : library.setTags({ ...input, id: parseId(input.id, "Skill id") });
  });
  diagnosticHandle("skill-summaries:config", () => store.config());
  diagnosticHandle("skill-summaries:prepare", async (_event, previewId) => {
    const snapshot = await library.readSummaryInput(z.string().uuid().parse(previewId));
    return { fileCount: snapshot.files.length, omittedPaths: snapshot.omittedPaths };
  });
  diagnosticHandle("skill-summaries:configure", (_event, input: unknown) => store.saveConfig(
    z.object({ endpoint: z.string().max(2048), model: z.string().max(150), apiKey: z.string().max(4096).optional() }).parse(input)
  ));
  diagnosticHandle("skill-summaries:history", (_event, id) => store.history(parseId(id, "Skill id")));
  diagnosticHandle("skill-summaries:generate", (_event, input) => service.generate(input));
  diagnosticHandle("skill-summaries:cancel", (_event, id) => service.cancel(z.string().uuid().parse(id)));
};
