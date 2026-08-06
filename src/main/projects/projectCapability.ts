import type {
  AgentProjectCapability,
  ProjectCapabilitySupport,
  ProjectSkillLocationDeclaration
} from "../targets/types";

interface ProjectCapabilityDeclaration {
  support: ProjectCapabilitySupport;
  instructionFiles: readonly string[];
  instructionCreateFile?: string;
  skillLocations: readonly ProjectSkillLocationDeclaration[];
  mcpFiles: readonly string[];
  compareResourcePaths: readonly string[];
  launchArgs?: readonly string[];
}

const uniquePaths = (paths: readonly string[]): string[] => [...new Set(paths)];

const uniqueSkillLocations = (
  locations: readonly ProjectSkillLocationDeclaration[]
): ProjectSkillLocationDeclaration[] => {
  const result = new Map<string, ProjectSkillLocationDeclaration>();
  for (const location of locations) {
    if (!Number.isFinite(location.priority)) {
      throw new Error(`Project Skill location priority must be finite: ${location.relativePath}`);
    }
    if (!result.has(location.relativePath)) result.set(location.relativePath, { ...location });
  }
  return [...result.values()];
};

export const createProjectCapability = (
  declaration: ProjectCapabilityDeclaration
): AgentProjectCapability => {
  if (
    declaration.instructionCreateFile &&
    !declaration.instructionFiles.includes(declaration.instructionCreateFile)
  ) {
    throw new Error("Project instruction create file must also be declared for inspection");
  }
  if (
    declaration.instructionCreateFile &&
    declaration.support.instructions.mutate !== "supported"
  ) {
    throw new Error("Project instruction creation requires supported instruction mutation");
  }
  const launchArgs = [...(declaration.launchArgs ?? [])];
  return {
    support: {
      ...declaration.support,
      instructions: { ...declaration.support.instructions },
      skills: { ...declaration.support.skills },
      mcp: { ...declaration.support.mcp }
    },
    instructionFiles: uniquePaths(declaration.instructionFiles),
    instructionCreateFile: declaration.instructionCreateFile,
    skillLocations: uniqueSkillLocations(declaration.skillLocations),
    mcpFiles: uniquePaths(declaration.mcpFiles),
    compareResourcePaths: uniquePaths(declaration.compareResourcePaths),
    createLaunchSpec: ({ executablePath, projectRoot }) =>
      declaration.support.cliLaunch === "supported" && executablePath
        ? {
            executablePath,
            args: [...launchArgs],
            cwd: projectRoot
          }
        : undefined
  };
};
