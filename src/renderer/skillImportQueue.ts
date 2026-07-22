import type {
  GitHubSkillImportProgress,
  SkillImportQueueOptions
} from "./components/SkillLibraryPanel";

interface SkillImportQueueAdapter<Input, Prepared, Imported, Failure> {
  progressKey(input: Input): string;
  prepare(input: Input): Promise<Prepared | undefined>;
  importPrepared(input: Prepared): Promise<Imported>;
  failure(input: Input, error: unknown): Failure;
  updatesSource?(input: Prepared): boolean;
}

export interface SkillImportQueueResult<Imported, Failure> {
  imported: Imported[];
  failed: Failure[];
  updatedSourceCount: number;
}

export const runSkillImportQueue = async <Input, Prepared, Imported, Failure>(
  inputs: Input[],
  options: SkillImportQueueOptions | undefined,
  adapter: SkillImportQueueAdapter<Input, Prepared, Imported, Failure>
): Promise<SkillImportQueueResult<Imported, Failure>> => {
  const imported: Imported[] = [];
  const failed: Failure[] = [];
  let updatedSourceCount = 0;
  const report = (progress: GitHubSkillImportProgress) => options?.onProgress?.(progress);

  for (const input of inputs) {
    const sourceUrl = adapter.progressKey(input);
    if (options?.shouldStop?.()) {
      report({ sourceUrl, status: "skipped" });
      continue;
    }
    try {
      report({ sourceUrl, status: "reviewing" });
      const prepared = await adapter.prepare(input);
      if (options?.shouldStop?.() || !prepared) {
        report({ sourceUrl, status: "skipped" });
        continue;
      }
      if (adapter.updatesSource?.(prepared)) updatedSourceCount += 1;
      report({ sourceUrl, status: "importing" });
      const result = await adapter.importPrepared(prepared);
      imported.push(result);
      report({ sourceUrl, status: "imported" });
    } catch (error) {
      if (options?.shouldStop?.()) {
        report({ sourceUrl, status: "skipped" });
        continue;
      }
      failed.push(adapter.failure(input, error));
      report({
        sourceUrl,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { imported, failed, updatedSourceCount };
};
