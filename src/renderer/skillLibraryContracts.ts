import type { RepositorySkillImportInput } from "../shared/types";

export type SkillUpdateCheckStatus = {
  state: "checking" | "success" | "error" | "info";
  message: string;
};

export type SkillUpdateActionResult =
  | { status: "completed" }
  | { status: "failed"; error?: string }
  | { status: "partial"; error: string };

export type GitHubSkillImportItemStatus =
  | "waiting"
  | "reviewing"
  | "importing"
  | "imported"
  | "failed"
  | "skipped";

export interface GitHubSkillImportProgress {
  sourceUrl: string;
  status: GitHubSkillImportItemStatus;
  error?: string;
}

export interface SkillImportQueueOptions {
  onProgress?: (progress: GitHubSkillImportProgress) => void;
  shouldStop?: () => boolean;
}

export const repositoryImportProgressKey = (
  input: Pick<RepositorySkillImportInput, "repository" | "ref" | "directory">
) => `${input.repository}\0${input.ref ?? ""}\0${input.directory ?? ""}`;

export interface PreparedSkillTarget {
  targetId: string;
  targetName: string;
  disposition: "install" | "omit";
  libraryId: string;
  sharedPaths: string[];
}
