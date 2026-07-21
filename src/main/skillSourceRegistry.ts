import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { SkillSourceRecord, SkillSourceScope } from "../shared/types";
import { isMissingFileError, writeAtomic } from "./fileUtils";

interface SkillSourceRegistryFile {
  formatVersion: 1;
  sources: SkillSourceRecord[];
}

const sourceKey = (source: Pick<SkillSourceScope, "repository" | "ref" | "directory">) =>
  `${source.repository}\0${source.ref}\0${source.directory}`;

const sourceIdFor = (scope: SkillSourceScope) =>
  `source-${createHash("sha256").update(sourceKey(scope)).digest("hex").slice(0, 20)}`;

const isSourceRecord = (value: unknown): value is SkillSourceRecord => {
  if (!value || typeof value !== "object") return false;
  const source = value as Record<string, unknown>;
  return source.formatVersion === 1 &&
    typeof source.id === "string" &&
    typeof source.canonicalLink === "string" &&
    typeof source.repository === "string" &&
    typeof source.ref === "string" &&
    typeof source.directory === "string" &&
    typeof source.createdAt === "string" &&
    typeof source.updatedAt === "string";
};

export interface SkillSourceRegistry {
  list(): Promise<SkillSourceRecord[]>;
  ensure(scopes: SkillSourceScope[]): Promise<SkillSourceRecord[]>;
  replace(records: SkillSourceRecord[]): Promise<void>;
}

export const createSkillSourceRegistry = (path: string): SkillSourceRegistry => {
  let mutationQueue = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const list = async (): Promise<SkillSourceRecord[]> => {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<SkillSourceRegistryFile>;
      if (parsed.formatVersion !== 1 || !Array.isArray(parsed.sources) ||
        !parsed.sources.every(isSourceRecord)) {
        throw new Error(`Invalid Skill source registry: ${path}`);
      }
      return parsed.sources;
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  };

  const writeRecords = async (records: SkillSourceRecord[]) => {
    const unique = new Map(records.map((record) => [record.id, record]));
    await writeAtomic(path, `${JSON.stringify({
      formatVersion: 1,
      sources: [...unique.values()].sort((left, right) => left.id.localeCompare(right.id))
    }, null, 2)}\n`);
  };

  const replace = (records: SkillSourceRecord[]) => serialize(() => writeRecords(records));

  const ensure = (scopes: SkillSourceScope[]) => serialize(async () => {
    const records = await list();
    const byKey = new Map(records.map((record) => [sourceKey(record), record]));
    let changed = false;
    const resolved = scopes.map((scope) => {
      const key = sourceKey(scope);
      const existing = byKey.get(key);
      if (existing) {
        if (existing.canonicalLink !== scope.canonicalLink) {
          existing.canonicalLink = scope.canonicalLink;
          existing.updatedAt = new Date().toISOString();
          changed = true;
        }
        return existing;
      }
      const now = new Date().toISOString();
      const record: SkillSourceRecord = {
        ...scope,
        id: sourceIdFor(scope),
        createdAt: now,
        updatedAt: now
      };
      records.push(record);
      byKey.set(key, record);
      changed = true;
      return record;
    });
    if (changed) await writeRecords(records);
    return resolved;
  });

  return { list, ensure, replace };
};

export const bindSkillSourceCollection = async (
  registry: SkillSourceRegistry,
  collection: import("../shared/types").SkillSourceCollectionRef | undefined
) => {
  if (!collection) return undefined;
  const [record] = await registry.ensure([collection]);
  return { ...collection, sourceId: record!.id };
};
