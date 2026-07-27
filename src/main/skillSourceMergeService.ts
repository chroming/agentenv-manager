import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type {
  RepositorySkillScanResult,
  ProjectSkillScanResult,
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
import { createLocalSkillSourceScope, createSkillSourceScope } from "./skillSourceScope";
import type { SkillSourceRegistry } from "./skillSourceRegistry";
import { validateSkillSourceMerge } from "./skillSourceMerge";
import type { GitCliSkillSource } from "./skillSources/contract";
import { scanProjectSkillRoots } from "./projectSkillDiscovery";

interface PendingSkillSourceMerge {
  preview: SkillSourceMergePreview;
  result: RepositorySkillScanResult | ProjectSkillScanResult;
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
    const requestedRootPath = input.rootPath && sources.every(
      (source) => (source.sourceKind ?? source.kind) === "local"
    )
      ? await realpath(input.rootPath).catch(() => input.rootPath)
      : input.rootPath;
    const mergeScope = validateSkillSourceMerge(sources, input.directory, requestedRootPath);
    const result = mergeScope.kind === "local"
      ? await scanProjectSkillRoots([mergeScope.repository], await options.listSkills())
      : await (async () => {
          if (!options.repositorySource) {
            throw new Error("System Git is unavailable. Install Git and retry the source merge.");
          }
          return options.repositorySource.scan({
            repository: mergeScope.repository,
            ref: mergeScope.ref,
            directory: mergeScope.directory,
            transport: "system-git"
          });
        })();
    const mergedSource = mergeScope.kind === "local"
      ? createLocalSkillSourceScope(mergeScope.repository)
      : (result as RepositorySkillScanResult).sourceScope ?? createSkillSourceScope(
          { ...mergeScope, transport: "system-git" },
          result as RepositorySkillScanResult
        );
    const existingTarget = groups.find((group) =>
      scopeKey(group) === scopeKey(mergedSource) && !sourceIds.includes(group.sourceId)
    );
    const automaticCheckSources = [...sources, ...(existingTarget ? [existingTarget] : [])];
    const affectedSourceIds = [...sourceIds, ...(existingTarget ? [existingTarget.sourceId] : [])];
    const affectedSkills = (await options.listSkills()).filter((skill) =>
      skill.sourceCollection && affectedSourceIds.includes(
        skill.sourceCollection.sourceId ?? skill.sourceCollection.canonicalLink
      )
    );
    const blockers: string[] = [];
    if (result.truncated) blockers.push("The merged source scan was incomplete");
    if ("issues" in result && result.issues.length > 0) {
      blockers.push(...result.issues.map((issue) => issue.message));
    }
    const paths = new Map<string, string[]>();
    for (const skill of affectedSkills) {
      const collection = skill.sourceCollection!;
      const candidateDirectory = mergeScope.kind === "local"
        ? resolve(collection.repository, collection.sourceSubpath)
        : [collection.directory, collection.sourceSubpath].filter(Boolean).join("/");
      try {
        const sourceSubpath = mergeScope.kind === "local"
          ? relative(mergedSource.repository, candidateDirectory).split("\\").join("/")
          : sourceSubpathFor(mergedSource.directory, candidateDirectory);
        if (sourceSubpath === ".." || sourceSubpath.startsWith("../")) {
          throw new Error(`Skill path is outside its source scope: ${candidateDirectory}`);
        }
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
      ...(mergeScope.kind === "repository" && !mergedSource.directory
        ? ["The merged source scans the whole repository"]
        : []),
      ...(existingTarget ? ["The selected sources will merge into an existing source group"] : []),
      ...(new Set(automaticCheckSources.map((source) => source.automaticChecks !== false)).size > 1
        ? ["Automatic checks will be turned off because the selected sources use different settings"]
        : [])
    ];
    const automaticChecks = automaticCheckSources.every(
      (source) => source.automaticChecks !== false
    );
    const mergePreview: SkillSourceMergePreview = {
      id: randomUUID(),
      sourceIds,
      sources,
      mergedSource,
      automaticChecks,
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
    const mergedIgnoredSubpaths = new Set<string>();
    for (const record of pending.sourceRegistrySnapshot.filter((source) =>
      pending.affectedSourceIds.includes(source.id)
    )) {
      for (const ignoredSubpath of record.ignoredSubpaths ?? []) {
        const candidateDirectory = pending.preview.mergedSource.kind === "local"
          ? resolve(record.repository, ignoredSubpath)
          : [record.directory, ignoredSubpath].filter(Boolean).join("/");
        const mergedSubpath = pending.preview.mergedSource.kind === "local"
          ? relative(
              pending.preview.mergedSource.repository,
              candidateDirectory
            ).split("\\").join("/")
          : sourceSubpathFor(
              pending.preview.mergedSource.directory,
              candidateDirectory
            );
        if (mergedSubpath === ".." || mergedSubpath.startsWith("../")) {
          throw new Error(`Ignored Skill path is outside the merged source: ${candidateDirectory}`);
        }
        mergedIgnoredSubpaths.add(mergedSubpath);
      }
    }
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
      await options.sourceRegistry.setAutomaticChecks(
        mergedRecord!.id,
        pending.preview.automaticChecks
      );
      for (const ignoredSubpath of mergedIgnoredSubpaths) {
        await options.sourceRegistry.setIgnoredSubpath(
          mergedRecord!.id,
          ignoredSubpath,
          true
        );
      }
      for (const skill of affectedSkills) {
        const collection = skill.sourceCollection!;
        const localSource = pending.preview.mergedSource.kind === "local";
        const candidateDirectory = localSource
          ? resolve(collection.repository, collection.sourceSubpath)
          : [collection.directory, collection.sourceSubpath].filter(Boolean).join("/");
        const metadataPath = join(skill.path, ".agentenv-skill.json");
        const metadata = JSON.parse(snapshots.get(metadataPath)!) as SkillMetadataFile;
        metadata.sourceCollection = {
          ...pending.preview.mergedSource,
          sourceId: mergedRecord!.id,
          sourceSubpath: localSource
            ? relative(pending.preview.mergedSource.repository, candidateDirectory).split("\\").join("/")
            : sourceSubpathFor(
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
      if (pending.preview.mergedSource.kind === "local") {
        await options.sourceService.recordLocalScan(
          pending.preview.mergedSource,
          pending.result as ProjectSkillScanResult
        );
      } else {
        await options.sourceService.recordRepositoryScan(
          pending.preview.mergedSource,
          pending.result as RepositorySkillScanResult
        );
      }
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
