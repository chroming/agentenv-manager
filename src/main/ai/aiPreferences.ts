import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { writeAtomic } from "../fileUtils";
import { aiFeatures, defaultAIPreferences, type AIFeature, type AIPreferences } from "../../shared/aiAssistance";

export const AIPreferencesSchema = z.object({ enabled: z.boolean(), features: z.object({
  summaries: z.boolean(), tags: z.boolean(), comparison: z.boolean(), duplicates: z.boolean(), profile: z.boolean()
}) });
export const createAIPreferences = (root: string) => {
  const path = join(root, "ai-preferences.json");
  let value: AIPreferences | undefined;
  const active = new Map<AbortController, AIFeature>();
  let writes = Promise.resolve();
  const read = async () => {
    if (value) return structuredClone(value);
    try { value = AIPreferencesSchema.parse(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("AI settings could not be read. No AI request was sent.");
      value = defaultAIPreferences();
    }
    return structuredClone(value);
  };
  const assertEnabled = async (feature: AIFeature) => {
    const prefs = await read();
    if (!prefs.enabled || !prefs.features[feature]) throw new Error("This AI feature is turned off in Settings.");
  };
  return {
    read, assertEnabled,
    save(input: AIPreferences) {
      const next = AIPreferencesSchema.parse(input);
      const operation = writes.then(async () => {
        await writeAtomic(path, `${JSON.stringify(next)}\n`, { mode: 0o600 });
        value = next;
        for (const [controller, feature] of active) if (!next.enabled || !next.features[feature]) controller.abort();
        return structuredClone(next);
      });
      writes = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async run<T>(feature: AIFeature, operation: (signal: AbortSignal) => Promise<T>) {
      z.enum(aiFeatures).parse(feature);
      const controller = new AbortController();
      active.set(controller, feature);
      try {
        await assertEnabled(feature); controller.signal.throwIfAborted();
        return await operation(controller.signal);
      } finally { active.delete(controller); }
    }
  };
};
