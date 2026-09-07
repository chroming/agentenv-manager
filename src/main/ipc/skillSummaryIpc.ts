import { BrowserWindow, safeStorage } from "electron";
import { z } from "zod";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { IpcRegistrationHandles } from "./registration";
import { parseId } from "./registration";
import { isSecureTokenStorageAvailable } from "../githubAuthService";
import { createSummaryStore } from "../skillSummaries/summaryStore";
import { createSummaryService } from "../skillSummaries/summaryService";
import { createAIJsonClient } from "../ai/aiJsonClient";
import { testAIService } from "../ai/testAIService";
import { createSkillTagSuggestionService } from "../ai/skillTagSuggestions";
import { createAIPreferences } from "../ai/aiPreferences";
import { createAnalysisInputs, AnalysisSubjectSchema, type AnalysisDependencies } from "../ai/analysisInputs";
import { createAnalysisService } from "../ai/analysisService";
import type { AIFeature } from "../../shared/aiAssistance";

export const registerSkillSummaryIpc = (
  { diagnosticHandle, handleMutation }: IpcRegistrationHandles,
  root: string,
  library: SkillLibraryStore,
  dependencies: Omit<AnalysisDependencies, "library">
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
  const preferences = createAIPreferences(root);
  const analyses = createAnalysisService({ root, configStore: store, request, readInput: createAnalysisInputs({ ...dependencies, library }) });
  const guarded = <T,>(feature: AIFeature, id: string, cancel: (id: string) => void, run: () => Promise<T>) =>
    preferences.run(feature, async (signal) => {
      const stop = () => cancel(id);
      signal.addEventListener("abort", stop, { once: true });
      try { signal.throwIfAborted(); return await run(); }
      finally { signal.removeEventListener("abort", stop); }
    });
  diagnosticHandle("ai:preferences", () => preferences.read());
  diagnosticHandle("ai:configure", async (_event, input) => {
    const result = await preferences.save(input);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("ai:preferences-changed", result);
    return result;
  });
  diagnosticHandle("ai:prepare", (_event, subject, locale) => analyses.prepare(AnalysisSubjectSchema.parse(subject), z.enum(["en", "zh_CN", "zh_TW"]).parse(locale)));
  diagnosticHandle("ai:generate", (_event, input) => {
    const subject = AnalysisSubjectSchema.parse(input.subject);
    return guarded(subject.kind, input.requestId, analyses.cancel, () => analyses.generate({ ...input, subject }));
  });
  diagnosticHandle("ai:cancel", (_event, id) => analyses.cancel(z.string().uuid().parse(id)));
  diagnosticHandle("skill-tags:prepare", (_event, ids, locale) => tags.prepareBatch(z.array(z.string()).parse(ids), z.enum(["en", "zh_CN", "zh_TW"]).parse(locale)));
  diagnosticHandle("skill-tags:generate", (_event, input) => guarded("tags", input.requestId, tags.cancel, () => tags.generate(input)));
  diagnosticHandle("skill-tags:cancel", (_event, id) => tags.cancel(z.string().uuid().parse(id)));
  handleMutation("skills:set-tags", (_event, raw) => {
    const input = z.object({ id: z.string(), tags: z.array(z.string()), fixedTags: z.array(z.string()).max(12).optional(), suggestionKey: z.string().regex(/^[a-f0-9]{64}$/).optional() }).parse(raw);
    return input.suggestionKey ? tags.apply(input) : library.setTags({ ...input, id: parseId(input.id, "Skill id") });
  });
  diagnosticHandle("skill-summaries:config", () => store.config());
  diagnosticHandle("skill-summaries:test", async () => testAIService(await store.credentials(), request));
  diagnosticHandle("skill-summaries:prepare", async (_event, previewId) => {
    const snapshot = await library.readSummaryInput(z.string().uuid().parse(previewId));
    return { fileCount: snapshot.files.length, omittedPaths: snapshot.omittedPaths };
  });
  diagnosticHandle("skill-summaries:configure", (_event, input: unknown) => store.saveConfig(
    z.object({ endpoint: z.string().max(2048), model: z.string().max(150), apiKey: z.string().max(4096).optional() }).parse(input)
  ));
  diagnosticHandle("skill-summaries:history", (_event, id) => store.history(parseId(id, "Skill id")));
  diagnosticHandle("skill-summaries:generate", (_event, input) => guarded("summaries", input.requestId, service.cancel, () => service.generate(input)));
  diagnosticHandle("skill-summaries:cancel", (_event, id) => service.cancel(z.string().uuid().parse(id)));
};
