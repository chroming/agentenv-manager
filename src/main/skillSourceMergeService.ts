import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RepositorySkillScanResult,
  SkillLibraryEntry,
  SkillSourceGroupView,
  SkillSourceMergePreview,
  SkillSourceMergePreviewInput,
  SkillSourceMergeResult,
  SkillSourceRecord,
  SkillSourceScope
} from "../shared/types";
import { sourceSubpathFor } from "../shared/skillSourceGrouping";
import { writeAtomic } from "./fileUtils";
import type { SkillMetadataFile } from "./skillLibraryMetadata";
import type { SkillSourceService } from "./skillSourceService";
import { createSkillSourceScope } from "./skillSourceScope";
import type { SkillSourceRegistry } from "./skillSourceRegistry";
import { validateSkillSourceMerge } from "./skillSourceMerge";
import type { GitCliSkillSource } from "./skillSources/contract";

interface PendingSkillSourceMerge {
  preview: SkillSourceMergePreview;
  result: RepositorySkillScanResult;
  affectedSourceIds: string[];
  affectedSkillIds: string[];
  sourceRegistrySnapshot: SkillSourceRecord[];
  createdAt: number;
}

interface SkillSourceMergeServiceOptions {
  appDataRoot: string;
  repositorySource?: GitCliSkillSource;
  sourceRegistry: SkillSourceRegistry;
  sourceService: SkillSourceService;
  listSkills(): Promise<SkillLibraryEntry[]>;
  listSourceGroups(): Promise<SkillSourceGroupView[]>;
  now?: () => Date;
}

const PREVIEW_TTL_MS = 30 * 60 * 1000;

const scopeKey = (source: Pick<SkillSourceScope, "repository" | "ref" | "directory">) =>
  `${source.repository}\0${source.ref}\0${source.directory}`;

export const createSkillSourceMergeService = (options: SkillSourceMergeServiceOptions) => {
  const pendingMerges = new Map<string, PendingSkillSourceMerge>();
  const now = options.now ?? (() => new Date());

  const preview = async (
    input: SkillSourceMergePreviewInput
  ): Promise<SkillSourceMergePreview> => {
    const sourceIds = [...new Set(input.sourceIds.filter(Boolean))];
    const groups = await options.listSourceGroups();
    const selected = sourceIds.map((sourceId) => groups.find((group) => group.sourceId === sourceId));
    if (selected.some((group) => !group)) {
      throw new Error("One or more selected Skill sources no longer exist");
    }
    const sources = selected as SkillSourceGroupView[];
    const mergeScope = validateSkillSourceMerge(sources, input.directory);
    if (!options.repositorySource) {
      throw new Error("System Git is unavailable. Install Git and retry the source merge.");
    }
    const result = await options.repositorySource.scan({
      repository: mergeScope.repository,
      ref: mergeScope.ref,
      directory: mergeScope.directory,
      transport: "system-git"
    });
    const mergedSource = result.sourceScope ?? createSkillSourceScope(
      { ...mergeScope, transport: "system-git" },
      result
    );
    const existingTarget = groups.find((group) =>
      scopeKey(group) === scopeKey(mergedSource) && !sourceIds.includes(group.sourceId)
    );
    const affectedSourceIds = [...sourceIds, ...(existingTarget ? [existingTarget.sourceId] : [])];
    const affectedSkills = (await options.listSkills()).filter((skill) =>
      skill.sourceCollection && affectedSourceIds.includes(
        skill.sourceCollection.sourceId ?? skill.sourceCollection.canonicalLink
      )
    );
    const blockers: string[] = [];
    if (result.truncated) blockers.push("The merged source scan was incomplete");
    const paths = new Map<string, string[]>();
    for (const skill of affectedSkills) {
      const collection = skill.sourceCollection!;
      const candidateDirectory = [collection.directory, collection.sourceSubpath]
        .filter(Boolean).join("/");
      try {
        const sourceSubpath = sourceSubpathFor(mergedSource.directory, candidateDirectory);
        paths.set(sourceSubpath, [...(paths.get(sourceSubpath) ?? []), skill.name]);
      } catch (error) {
        blockers.push(error instanceof Error ? error.message : String(error));
      }
    }
    for (const [path, names] of paths) {
      if (names.length > 1) {
        blockers.push(`${names.length} Library Skills would use the same source path: ${path || "."}`);
      }
    }
    const warnings = [
      ...(!mergedSource.directory ? ["The merged source scans the whole repository"] : []),
      ...(existingTarget ? ["The selected sources will merge into an existing source group"] : [])
    ];
    const mergePreview: SkillSourceMergePreview = {
      id: randomUUID(),
      sourceIds,
      sources,
      mergedSource,
      affectedSkillCount: affectedSkills.length,
      discoveredSkillCount: result.candidates.length,
      mergesIntoExistingSource: Boolean(existingTarget),
      warnings,
      blockers: [...new Set(blockers)]
    };
    pendingMerges.set(mergePreview.id, {
      preview: mergePreview,
      result,
      affectedSourceIds,
      affectedSkillIds: affectedSkills.map((skill) => skill.id),
      sourceRegistrySnapshot: await options.sourceRegistry.list(),
      createdAt: now().getTime()
    });
    return mergePreview;
  };

  const merge = async (previewId: string): Promise<SkillSourceMergeResult> => {
    const pending = pendingMerges.get(previewId);
    if (!pending || now().getTime() - pending.createdAt > PREVIEW_TTL_MS) {
      pendingMerges.delete(previewId);
      throw new Error("Skill source merge preview expired. Review the merge again.");
    }
    if (pending.preview.blockers.length > 0) {
      throw new Error("Resolve the blocking source merge issues before continuing");
    }
    const affectedSkills = (await options.listSkills()).filter((skill) =>
      pending.affectedSkillIds.includes(skill.id)
    );
    if (affectedSkills.length !== pending.affectedSkillIds.length || affectedSkills.some((skill) =>
      !skill.sourceCollection || !pending.affectedSourceIds.includes(
        skill.sourceCollection.sourceId ?? skill.sourceCollection.canonicalLink
      ))) {
      throw new Error("Skill source membership changed after preview. Review the merge again.");
    }

    const stamp = now().toISOString().replace(/[:.]/g, "-");
    const backupPath = join(
      options.appDataRoot,
      "skill-source-merge-backups",
      `skill-source-merge-${stamp}-${previewId.slice(0, 8)}`
    );
    const snapshots = new Map<string, string>();
    await mkdir(backupPath, { recursive: true });
    for (const skill of affectedSkills) {
      const metadataPath = join(skill.path, ".agentenv-skill.json");
      const content = await readFile(metadataPath, "utf8");
      snapshots.set(metadataPath, content);
      await writeAtomic(join(backupPath, `${skill.id}.agentenv-skill.json`), content);
    }
    await writeAtomic(join(backupPath, "manifest.json"), `${JSON.stringify({
      formatVersion: 1,
      operation: "merge-skill-sources",
      createdAt: now().toISOString(),
      preview: pending.preview,
      sourceRegistry: pending.sourceRegistrySnapshot
    }, null, 2)}\n`);

    try {
      const [mergedRecord] = await options.sourceRegistry.ensure([pending.preview.mergedSource]);
      for (const skill of affectedSkills) {
        const collection = skill.sourceCollection!;
        const candidateDirectory = [collection.directory, collection.sourceSubpath]
          .filter(Boolean).join("/");
        const metadataPath = join(skill.path, ".agentenv-skill.json");
        const metadata = JSON.parse(snapshots.get(metadataPath)!) as SkillMetadataFile;
        metadata.sourceCollection = {
          ...pending.preview.mergedSource,
          sourceId: mergedRecord!.id,
          sourceSubpath: sourceSubpathFor(
            pending.preview.mergedSource.directory,
            candidateDirectory
          )
        };
        metadata.updatedAt = now().toISOString();
        await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
      }
      const records = await options.sourceRegistry.list();
      await options.sourceRegistry.replace(records.filter((record) =>
        !pending.affectedSourceIds.includes(record.id) || record.id === mergedRecord!.id
      ));
      await options.sourceService.recordRepositoryScan(pending.preview.mergedSource, pending.result);
      const group = (await options.listSourceGroups()).find((candidate) =>
        candidate.sourceId === mergedRecord!.id
      );
      if (!group || group.candidates.some((candidate) => candidate.state === "conflict")) {
        throw new Error("Merged Skill source could not be verified");
      }
      pendingMerges.delete(previewId);
      return {
        source: group,
        mergedSourceCount: pending.affectedSourceIds.length,
        affectedSkillCount: affectedSkills.length,
        backupPath
      };
    } catch (error) {
      await Promise.all([...snapshots].map(([path, content]) => writeAtomic(path, content)));
      await options.sourceRegistry.replace(pending.sourceRegistrySnapshot);
      throw error;
    }
  };

  return { preview, merge };
};
