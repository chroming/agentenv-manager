import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitCliSkillSource } from "./skillSources/contract";
import {
  GitHubSkillSymbolicLinkError,
  type createGitHubSkillClient,
  type ParsedGitHubSkillSource
} from "./githubSkillClient";
import { pathExists } from "./fileUtils";
import { hashSkillContent } from "./skillContentHash";

type GitHubTreeReader = ReturnType<typeof createGitHubSkillClient>["readTree"];

interface GitHubSkillTreeMaterializerOptions {
  readTree: GitHubTreeReader;
  repositorySource?: GitCliSkillSource;
  copySkillTree(source: string, destination: string): Promise<void>;
}

export const createGitHubSkillTreeMaterializer = ({
  readTree,
  repositorySource,
  copySkillTree
}: GitHubSkillTreeMaterializerOptions) => async (
  source: ParsedGitHubSkillSource,
  destination: string,
  readOptions: { refresh?: boolean; refreshFiles?: boolean } = {}
) => {
  try {
    return await readTree(source, destination, readOptions);
  } catch (error) {
    if (!(error instanceof GitHubSkillSymbolicLinkError)) throw error;
    if (!repositorySource) {
      throw new Error(
        `${error.message}. System Git is required to validate and import repository-internal symbolic links safely.`
      );
    }
    const manifest = await readTree(source, undefined, readOptions);
    const checkoutDir = await mkdtemp(join(tmpdir(), "agentenv-github-skill-link-"));
    try {
      await repositorySource.materialize({
        repository: `https://github.com/${source.owner}/${source.repo}.git`,
        ref: source.ref,
        directory: source.remotePath || undefined,
        transport: "system-git"
      }, checkoutDir, undefined, {
        historyDepth: 1,
        refresh: readOptions.refresh ?? true
      });
      await hashSkillContent(checkoutDir);
      await copySkillTree(checkoutDir, destination);
      return {
        ...manifest,
        hasSkillMd: await pathExists(join(destination, "SKILL.md"))
      };
    } finally {
      await rm(checkoutDir, { recursive: true, force: true });
    }
  }
};
