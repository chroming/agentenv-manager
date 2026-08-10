import { readFile } from "node:fs/promises";
import type { AgentEnvPaths } from "./paths";
import { writeAtomic } from "./fileUtils";
import {
  UiStateSchema,
  UiStateUpdateSchema,
  defaultUiState,
  normalizeUiState,
  type UiState,
  type UiStateUpdate
} from "../shared/uiState";

export interface UiStateStore {
  read(): Promise<UiState>;
  update(input: UiStateUpdate): Promise<UiState>;
}

const isMissingFileError = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");

export const createUiStateStore = (paths: AgentEnvPaths): UiStateStore => {
  let writeQueue = Promise.resolve();

  const readFromDisk = async (): Promise<UiState> => {
    try {
      return normalizeUiState(UiStateSchema.parse(JSON.parse(
        await readFile(paths.uiStatePath, "utf8")
      )));
    } catch (error) {
      if (!isMissingFileError(error)) {
        console.warn(`[AgentEnv] Ignoring invalid UI state: ${
          error instanceof Error ? error.message : String(error)
        }`);
      }
      return defaultUiState();
    }
  };

  const read = async (): Promise<UiState> => {
    await writeQueue;
    return readFromDisk();
  };

  const update = (input: UiStateUpdate): Promise<UiState> => {
    const parsed = UiStateUpdateSchema.parse(input);
    const task = writeQueue.then(async () => {
      const current = await readFromDisk();
      const next = normalizeUiState(UiStateSchema.parse({
        ...current,
        ...parsed,
        version: 1
      }));
      await writeAtomic(paths.uiStatePath, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    });
    writeQueue = task.then(() => undefined, () => undefined);
    return task;
  };

  return { read, update };
};
