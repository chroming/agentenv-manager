import type { SkillMetadataFile } from "./skillLibraryMetadata";
import { parseGitHubSkillUrl } from "./githubSkillClient";

export const skillUpdateSourceGroupKey = (
  id: string,
  metadata: SkillMetadataFile
): string => {
  if (metadata.sourceType === "git" && metadata.source) {
    return `git:${metadata.source}\0${metadata.remoteRef ?? ""}`;
  }
  if (metadata.sourceType === "github" && metadata.source) {
    try {
      const source = parseGitHubSkillUrl(metadata.source, {
        ref: metadata.remoteRef,
        remotePath: metadata.remotePath
      });
      return `github:${source.owner}/${source.repo}\0${source.ref}`;
    } catch {
      return `github:${metadata.source}\0${metadata.remoteRef ?? ""}`;
    }
  }
  return `skill:${id}`;
};
