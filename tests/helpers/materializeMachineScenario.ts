import { mkdir, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type {
  MachineScenario,
  MachineScenarioEntry
} from "../machine-scenarios/schema";

const HOME_TOKEN = "{{HOME}}";

export const expandScenarioValue = (value: string, homeDir: string) =>
  value.replaceAll(HOME_TOKEN, homeDir);

export const scenarioPath = (homeDir: string, relativePath: string) =>
  resolve(homeDir, ...relativePath.replaceAll("\\", "/").split("/"));

const linkTarget = (
  entry: Extract<MachineScenarioEntry, { type: "symlink" }>,
  homeDir: string
) => {
  const expanded = expandScenarioValue(entry.target, homeDir);
  if (entry.linkKind === "junction" && !isAbsolute(expanded)) {
    return resolve(dirname(scenarioPath(homeDir, entry.path)), expanded);
  }
  return expanded;
};

export const materializeMachineScenario = async (
  homeDir: string,
  scenario: Pick<MachineScenario, "entries">
): Promise<void> => {
  for (const entry of scenario.entries.filter((candidate) => candidate.type === "directory")) {
    await mkdir(scenarioPath(homeDir, entry.path), { recursive: true });
  }
  for (const entry of scenario.entries.filter((candidate) => candidate.type === "file")) {
    const path = scenarioPath(homeDir, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, entry.content, "utf8");
  }
  for (const entry of scenario.entries.filter((candidate) => candidate.type === "symlink")) {
    const path = scenarioPath(homeDir, entry.path);
    await mkdir(dirname(path), { recursive: true });
    await symlink(linkTarget(entry, homeDir), path, entry.linkKind);
  }
};

export const scenarioEnvironment = (
  scenario: Pick<MachineScenario, "environment">,
  homeDir: string
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(scenario.environment).map(([key, value]) => [
      key,
      expandScenarioValue(value, homeDir)
    ])
  );
