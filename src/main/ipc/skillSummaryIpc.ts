import { safeStorage } from "electron";
import { z } from "zod";
import type { SkillLibraryStore } from "../skillLibraryStore";
import type { IpcRegistrationHandles } from "./registration";
import { parseId } from "./registration";
import { isSecureTokenStorageAvailable } from "../githubAuthService";
import { createSummaryStore } from "../skillSummaries/summaryStore";
import { createSummaryService } from "../skillSummaries/summaryService";

export const registerSkillSummaryIpc = (
  { diagnosticHandle }: IpcRegistrationHandles,
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
  const service = createSummaryService({ store, readInput: library.readSummaryInput });
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
