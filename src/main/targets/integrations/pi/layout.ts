import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface PiLayout {
  agentRoot: string;
  sessionsRoot: string;
  settingsPath: string;
  instructionsPath: string;
  skillsDir: string;
}

export interface ResolvePiLayoutInput {
  homeDir: string;
  rootDirOverride?: string;
  environment?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  readText?: (path: string) => string;
}

const absoluteEnvironmentPath = (
  value: string | undefined,
  homeDir: string
): string | undefined => {
  if (!value?.trim()) return undefined;
  const expanded = value.trim().replace(/^~(?=$|\/)/, homeDir);
  return isAbsolute(expanded) ? resolve(expanded) : undefined;
};

const configuredSessionsRoot = (
  settingsPath: string,
  homeDir: string,
  pathExists: (path: string) => boolean,
  readText: (path: string) => string
): string | undefined => {
  if (!pathExists(settingsPath)) return undefined;
  try {
    const parsed = JSON.parse(readText(settingsPath));
    const value =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as { sessionDir?: unknown }).sessionDir
        : undefined;
    if (typeof value !== "string" || !value.trim()) return undefined;
    const expanded = value.trim().replace(/^~(?=$|\/)/, homeDir);
    // Pi resolves relative session paths from the CLI's startup cwd. AgentEnv
    // has no reliable global cwd for that invocation, so it must not guess.
    return isAbsolute(expanded) ? resolve(expanded) : undefined;
  } catch {
    return undefined;
  }
};

export const resolvePiLayout = (input: ResolvePiLayoutInput): PiLayout => {
  const environment = input.environment ?? process.env;
  const canUseProcessEnvironment =
    input.environment !== undefined || input.homeDir === process.env.HOME;
  const environmentAgentRoot = canUseProcessEnvironment
    ? absoluteEnvironmentPath(environment.PI_CODING_AGENT_DIR, input.homeDir)
    : undefined;
  const agentRoot = resolve(
    input.rootDirOverride ??
    environmentAgentRoot ??
    join(input.homeDir, ".pi", "agent")
  );
  const settingsPath = join(agentRoot, "settings.json");
  const pathExists = input.pathExists ?? existsSync;
  const readText = input.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const environmentSessionsRoot = canUseProcessEnvironment
    ? absoluteEnvironmentPath(
        environment.PI_CODING_AGENT_SESSION_DIR,
        input.homeDir
      )
    : undefined;
  const sessionsRoot =
    environmentSessionsRoot ??
    configuredSessionsRoot(
      settingsPath,
      input.homeDir,
      pathExists,
      readText
    ) ??
    join(agentRoot, "sessions");

  return {
    agentRoot,
    sessionsRoot,
    settingsPath,
    instructionsPath: join(agentRoot, "AGENTS.md"),
    skillsDir: join(agentRoot, "skills")
  };
};
