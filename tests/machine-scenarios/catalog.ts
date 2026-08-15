import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  MachineScenarioCatalogSchema,
  type MachineScenario
} from "./schema";

const catalogPath = fileURLToPath(
  new URL("../fixtures/target-homes/compatibility.json", import.meta.url)
);

export const loadMachineScenarioCatalog = async (): Promise<MachineScenario[]> => {
  const parsed = MachineScenarioCatalogSchema.parse(
    JSON.parse(await readFile(catalogPath, "utf8"))
  );
  return parsed.scenarios;
};

export const selectMachineScenarios = async (input: {
  platform?: NodeJS.Platform;
  scenarioId?: string;
} = {}): Promise<MachineScenario[]> => {
  const scenarios = await loadMachineScenarioCatalog();
  const requested = input.scenarioId?.trim();
  if (requested && !scenarios.some((scenario) => scenario.id === requested)) {
    throw new Error(`Unknown machine scenario: ${requested}`);
  }
  const platform = input.platform ?? process.platform;
  const selected = scenarios.filter(
    (scenario) =>
      (!requested || scenario.id === requested) &&
      scenario.platforms.includes(platform as "darwin" | "linux" | "win32")
  );
  if (requested && selected.length === 0) {
    throw new Error(`Machine scenario ${requested} is not supported on ${platform}`);
  }
  return selected;
};
