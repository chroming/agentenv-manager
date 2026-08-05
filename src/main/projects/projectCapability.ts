import type {
  AgentProjectCapability,
  ProjectCapabilitySupport
} from "../targets/types";

interface ProjectCapabilityDeclaration {
  support: ProjectCapabilitySupport;
  instructionFiles: readonly string[];
  skillDirectories: readonly string[];
  mcpFiles: readonly string[];
  compareResourcePaths: readonly string[];
  launchArgs?: readonly string[];
}

const uniquePaths = (paths: readonly string[]): string[] => [...new Set(paths)];

export const createProjectCapability = (
  declaration: ProjectCapabilityDeclaration
): AgentProjectCapability => {
  const launchArgs = [...(declaration.launchArgs ?? [])];
  return {
    support: {
      ...declaration.support,
      instructions: { ...declaration.support.instructions },
      skills: { ...declaration.support.skills },
      mcp: { ...declaration.support.mcp }
    },
    instructionFiles: uniquePaths(declaration.instructionFiles),
    skillDirectories: uniquePaths(declaration.skillDirectories),
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
