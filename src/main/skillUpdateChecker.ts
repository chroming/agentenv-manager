import { SafeIdSchema } from "../shared/schemas";
import type { SkillLibraryEntry, SkillUpdateInfo } from "../shared/types";
import { join } from "node:path";
import {
  parseGitHubSkillUrl,
  type createGitHubSkillClient,
  type GitHubCommitResponse,
  type GitHubTreeResponse,
  type ParsedGitHubSkillSource
} from "./githubSkillClient";
import { githubContentsRevision } from "./skillSources/revisionCompatibility";
import { RepositorySkillSourceMissingError } from "./skillSources/gitCliSource";
import type { GitCliSkillSource } from "./skillSources/contract";
import type { SkillMetadataFile } from "./skillLibraryMetadata";
import type { createRecentSkillUpdateCheckStore } from "./skillUpdatePreviewStore";

interface SkillUpdateCheckerOptions {
  computeContentHash(path: string): Promise<string>;
  githubClient: Pick<
    ReturnType<typeof createGitHubSkillClient>,
    "fetchJson" | "readSkillUpdatedAt" | "readTree"
  >;
  listSkills(): Promise<SkillLibraryEntry[]>;
  metadataHash(metadata: SkillMetadataFile): string;
  pathExists(path: string): Promise<boolean>;
  readMetadata(path: string): Promise<SkillMetadataFile>;
  recentChecks: ReturnType<typeof createRecentSkillUpdateCheckStore>;
  repositorySource?: Pick<GitCliSkillSource, "resolve">;
}

export const createSkillUpdateChecker = (options: SkillUpdateCheckerOptions) =>
  async (ids?: string[]): Promise<SkillUpdateInfo[]> => {
    const skills = await options.listSkills();
    const selectedIds = ids ? new Set(ids.map((id) => SafeIdSchema.parse(id))) : undefined;
    const selectedSkills = skills.filter(
      (item) =>
        (!selectedIds || selectedIds.has(item.id)) &&
        item.updatePolicy === "tracked" &&
        item.globallyEnabled &&
        Boolean(item.source)
    );
    const githubManifests = new Map<string, Promise<Array<{
      path: string;
      type: "blob" | "tree";
      sha: string;
    }> | undefined>>();
    const checkedMetadataHashes = new Map<string, string>();
    const githubManifestFor = (source: ParsedGitHubSkillSource) => {
      const key = `${source.owner}/${source.repo}\0${source.ref}`;
      const existing = githubManifests.get(key);
      if (existing) return existing;
      const request = (async () => {
        try {
          const commitUrl = `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`;
          const commit = await options.githubClient.fetchJson(
            commitUrl,
            { refresh: true }
          ) as GitHubCommitResponse;
          const treeSha = commit.commit?.tree?.sha;
          if (!treeSha) return undefined;
          const tree = await options.githubClient.fetchJson(
            `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
            { refresh: true }
          ) as GitHubTreeResponse;
          if (tree.truncated) return undefined;
          return (tree.tree ?? []).filter((entry): entry is {
            path: string;
            type: "blob" | "tree";
            sha: string;
          } =>
            (entry.type === "blob" || entry.type === "tree") &&
            typeof entry.path === "string" &&
            typeof entry.sha === "string"
          );
        } catch {
          return undefined;
        }
      })();
      githubManifests.set(key, request);
      return request;
    };
    const results = await Promise.all(selectedSkills.map(async (skill): Promise<SkillUpdateInfo> => {
      const metadata = await options.readMetadata(skill.path);
      checkedMetadataHashes.set(skill.id, options.metadataHash(metadata));
      if (!metadata.source) {
        return {
          id: skill.id,
          name: skill.name,
          sourceType: skill.sourceType,
          currentRevision: metadata.remoteRevision,
          updateAvailable: false,
          error: "Missing update source"
        };
      }
      try {
        if (metadata.sourceType === "local") {
          if (!(await options.pathExists(join(metadata.source, "SKILL.md")))) {
            throw new Error(`Skill source is missing SKILL.md: ${metadata.source}`);
          }
          const latestRevision = await options.computeContentHash(metadata.source);
          return {
            id: skill.id,
            name: skill.name,
            sourceType: "local",
            currentRevision: metadata.contentHash,
            latestRevision,
            updateAvailable: latestRevision !== metadata.contentHash
          };
        }
        if (metadata.sourceType === "git") {
          if (!options.repositorySource) {
            throw new Error("System Git is unavailable. Install Git and retry the Repository operation.");
          }
          const repositoryInput = {
            repository: metadata.source,
            ref: metadata.remoteRef,
            directory: metadata.remotePath,
            transport: "system-git" as const
          };
          const quickLatest = await options.repositorySource.resolve(
            repositoryInput,
            undefined,
            { refresh: true, historyDepth: 1, includeUpdatedAt: false }
          );
          const updateAvailable = quickLatest.contentRevision !== metadata.remoteRevision;
          const latest = updateAvailable
            ? await options.repositorySource.resolve(repositoryInput, undefined, {
                refresh: false,
                historyDepth: 128,
                includeUpdatedAt: true
              })
            : quickLatest;
          return {
            id: skill.id,
            name: skill.name,
            sourceType: "git",
            currentRevision: metadata.remoteRevision,
            latestRevision: latest.contentRevision,
            latestUpdatedAt: updateAvailable
              ? latest.upstream.updatedAt
              : metadata.upstream?.updatedAt,
            updateAvailable
          };
        }
        if (metadata.sourceType !== "github") {
          throw new Error(`Skill update source type is not supported: ${metadata.sourceType}`);
        }
        const source = parseGitHubSkillUrl(metadata.source, {
          ref: metadata.remoteRef,
          remotePath: metadata.remotePath
        });
        const manifest = await githubManifestFor(source);
        const skillManifestPath = [source.remotePath, "SKILL.md"].filter(Boolean).join("/");
        const githubTree = manifest
          ? undefined
          : await options.githubClient.readTree(source, undefined, { refresh: true });
        const hasSkillMd = manifest
          ? manifest.some((entry) => entry.type === "blob" && entry.path === skillManifestPath)
          : githubTree?.hasSkillMd === true;
        if (!hasSkillMd) {
          return {
            id: skill.id,
            name: skill.name,
            sourceType: "github",
            currentRevision: metadata.remoteRevision,
            updateAvailable: false,
            sourceStatus: "removed"
          };
        }
        const latestRevision = manifest
          ? githubContentsRevision(source.remotePath, manifest)
          : githubTree!.revision;
        const updateAvailable = latestRevision !== metadata.remoteRevision;
        const latestUpdatedAt = updateAvailable
          ? await options.githubClient.readSkillUpdatedAt(source, { refresh: true })
          : metadata.upstream?.updatedAt;
        return {
          id: skill.id,
          name: skill.name,
          sourceType: "github",
          currentRevision: metadata.remoteRevision,
          latestRevision,
          latestUpdatedAt,
          updateAvailable
        };
      } catch (error) {
        if (error instanceof RepositorySkillSourceMissingError) {
          return {
            id: skill.id,
            name: skill.name,
            sourceType: metadata.sourceType ?? skill.sourceType,
            currentRevision: metadata.remoteRevision ?? metadata.contentHash,
            updateAvailable: false,
            sourceStatus: "removed"
          };
        }
        return {
          id: skill.id,
          name: skill.name,
          sourceType: metadata.sourceType ?? skill.sourceType,
          currentRevision: metadata.remoteRevision ?? metadata.contentHash,
          updateAvailable: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }));
    const checkedAt = Date.now();
    for (const result of results) {
      const checkedMetadataHash = checkedMetadataHashes.get(result.id);
      if (!result.error && checkedMetadataHash) {
        options.recentChecks.set(result.id, {
          checkedAt,
          metadataHash: checkedMetadataHash,
          sourceStatus: result.sourceStatus
        });
      }
    }
    return results;
  };
