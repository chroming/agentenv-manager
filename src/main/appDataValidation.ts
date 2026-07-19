import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { ResourceIconKeySchema, SafeIdSchema } from "../shared/schemas";
import { readAppDataManifest } from "./appDataFormat";
import { isMissingFileError } from "./fileUtils";
import { createPaths } from "./paths";
import { createProfileStore } from "./profileStore";
import { parseSettingsData } from "./settingsStore";
import { parseSkillFrontmatter } from "./skillFrontmatter";
import { createSkillLibraryStore } from "./skillLibraryStore";
import { parseTargetState } from "./targetState";
import { createTargetRegistry, type TargetRegistry } from "./targets/registry";

const GitHubTokenFileSchema = z.object({ token: z.string().min(1) });
const SkillMetadataFileSchema = z.object({
  sourceType: z.enum(["local", "github", "git", "zip"]).optional(),
  source: z.string().optional(),
  remoteRef: z.string().optional(),
  remotePath: z.string().optional(),
  remoteRevision: z.string().optional(),
  updateCheckEnabled: z.boolean().optional(),
  updatePolicy: z.enum(["tracked", "untracked"]).optional(),
  globallyEnabled: z.boolean().optional(),
  iconKey: ResourceIconKeySchema.optional(),
  contentHash: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
  upstream: z.object({
    kind: z.enum(["github", "gitlab", "git", "local", "well-known"]),
    locator: z.string().min(1),
    ref: z.string().optional(),
    subpath: z.string().optional(),
    revision: z.string().optional()
  }).optional(),
  provenance: z.object({
    importedVia: z.enum(["agentenv", "local-scan"]),
    externalManager: z.literal("skills-cli").optional(),
    externalLockPath: z.string().optional()
  }).optional()
});
const SkillIgnoreRulesSchema = z.array(
  z.object({
    scope: z.enum(["group", "location"]),
    skillKey: z.string().optional(),
    path: z.string().optional()
  }).refine(
    (rule) =>
      (rule.scope === "group" && Boolean(rule.skillKey)) ||
      (rule.scope === "location" && Boolean(rule.path)),
    "Skill ignore rule is incomplete"
  )
);

const readJsonIfPresent = async (path: string): Promise<unknown | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
};

const listDirectoriesIfPresent = async (path: string) => {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
};

export const validateAppDataRoot = async (
  appDataRoot: string,
  targetRegistry: TargetRegistry = createTargetRegistry()
): Promise<void> => {
  const rootStats = await lstat(appDataRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("AgentEnv data must be a real directory");
  }

  await readAppDataManifest(appDataRoot);
  const paths = createPaths({
    appDataRoot,
    homeDir: join(appDataRoot, ".validation-home"),
    fakeHomeRoot: join(appDataRoot, ".validation-fake-home")
  });

  const settings = await readJsonIfPresent(join(appDataRoot, "settings.json"));
  if (settings !== undefined) parseSettingsData(settings);

  const token = await readJsonIfPresent(join(appDataRoot, "github-auth.json"));
  if (token !== undefined) GitHubTokenFileSchema.parse(token);

  const ignoreRules = await readJsonIfPresent(
    join(appDataRoot, "skill-cleanup-ignore-rules.json")
  );
  if (ignoreRules !== undefined) SkillIgnoreRulesSchema.parse(ignoreRules);

  const profileStore = createProfileStore({
    appDataRoot,
    homeDir: paths.homeDir,
    fakeHomeRoot: paths.fakeHomeRoot
  }, targetRegistry);
  for (const entry of await listDirectoriesIfPresent(paths.profilesDir)) {
    if (entry.name.startsWith(".") || entry.name.includes(".agentenv-")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Profile storage must be a real directory: ${entry.name}`);
    }
    const id = SafeIdSchema.parse(entry.name);
    const profile = await profileStore.readProfile(id);
    if (profile.manifest.id !== id) {
      throw new Error(`Profile directory and manifest ids differ: ${id}`);
    }
  }

  for (const entry of await listDirectoriesIfPresent(paths.skillsLibraryDir)) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Skill Library storage must be a real directory: ${entry.name}`);
    }
    SafeIdSchema.parse(entry.name);
    const skillDir = join(paths.skillsLibraryDir, entry.name);
    const frontmatter = parseSkillFrontmatter(
      await readFile(join(skillDir, "SKILL.md"), "utf8")
    );
    if (frontmatter.errors.length > 0) {
      throw new Error(
        `Skill Library entry ${entry.name} has invalid frontmatter: ${frontmatter.errors.join("; ")}`
      );
    }
    const metadata = await readJsonIfPresent(join(skillDir, ".agentenv-skill.json"));
    if (metadata !== undefined) SkillMetadataFileSchema.parse(metadata);
  }
  await createSkillLibraryStore(paths).listSkills();

  for (const entry of await listDirectoriesIfPresent(paths.targetStatesDir)) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      throw new Error(`Invalid Target state entry: ${entry.name}`);
    }
    SafeIdSchema.parse(basename(entry.name, ".json"));
    parseTargetState(JSON.parse(await readFile(join(paths.targetStatesDir, entry.name), "utf8")));
  }
};
