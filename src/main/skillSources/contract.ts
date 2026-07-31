import type {
  RepositorySkillScanResult,
  RepositorySkillSourceInput,
  SkillUpstream
} from "../../shared/types";
import type { RepositoryLocation } from "./repositoryLocation";

export interface ResolvedGitRepository {
  repository: string;
  location: RepositoryLocation;
  ref: string;
  resolvedCommit: string;
  cachePath: string;
  cacheRef: string;
  accessTransport: "https" | "ssh" | "file";
}

export interface ResolvedGitSkillSource extends ResolvedGitRepository {
  directory: string;
  contentRevision: string;
  upstream: SkillUpstream;
}

export interface MaterializedGitSkillSource extends ResolvedGitSkillSource {
  destination: string;
}

export interface GitSourceReadOptions {
  historyDepth?: number;
  includeBlobs?: boolean;
  refresh?: boolean;
}

export interface GitCliSkillSource {
  resolve(
    input: RepositorySkillSourceInput,
    signal?: AbortSignal,
    options?: GitSourceReadOptions
  ): Promise<ResolvedGitSkillSource>;
  scan(
    input: RepositorySkillSourceInput,
    signal?: AbortSignal,
    options?: GitSourceReadOptions
  ): Promise<RepositorySkillScanResult>;
  materialize(
    input: RepositorySkillSourceInput,
    destination: string,
    signal?: AbortSignal,
    options?: GitSourceReadOptions
  ): Promise<MaterializedGitSkillSource>;
}
