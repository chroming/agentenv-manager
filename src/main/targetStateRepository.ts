import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEnvPaths } from "./paths";
import { pathEntryExists, writeAtomic } from "./fileUtils";
import { defaultTargetState, parseTargetState } from "./targetState";
import type { TargetState } from "../shared/types";
import { hashFileContent } from "./filesystemIntegrity";

export class InvalidTargetStateError extends Error {
  constructor(readonly statePath: string) {
    super(
      `Agent management state is invalid and must be recovered before changes can continue: ${statePath}`
    );
    this.name = "InvalidTargetStateError";
  }
}

export interface TargetStateFile {
  path: string;
  content: string;
  pathHash?: string;
  state: TargetState;
}

export interface TargetStateRepository {
  pathFor(targetId: string): string;
  read(targetId: string): Promise<TargetStateFile>;
  write(
    targetId: string,
    state: TargetState,
    options?: { expectedPathHash?: string }
  ): Promise<void>;
}

export const createTargetStateRepository = (
  paths: AgentEnvPaths
): TargetStateRepository => {
  const pathFor = (targetId: string) =>
    join(paths.targetStatesDir, `${targetId}.json`);

  const read = async (targetId: string): Promise<TargetStateFile> => {
    const path = pathFor(targetId);
    if (!(await pathEntryExists(path))) {
      return { path, content: "", pathHash: undefined, state: defaultTargetState() };
    }
    const content = await readFile(path, "utf8");
    if (content.trim().length === 0) {
      throw new InvalidTargetStateError(path);
    }

    try {
      return {
        path,
        content,
        pathHash: hashFileContent(content),
        state: parseTargetState(JSON.parse(content))
      };
    } catch {
      throw new InvalidTargetStateError(path);
    }
  };

  const write = async (
    targetId: string,
    state: TargetState,
    options: { expectedPathHash?: string } = {}
  ) => {
    await mkdir(paths.targetStatesDir, { recursive: true, mode: 0o700 });
    const { keptOutsideSkills: _legacyKeptOutsideSkills, ...currentState } = state;
    const writeOptions = Object.prototype.hasOwnProperty.call(options, "expectedPathHash")
      ? { expectedTargetHash: options.expectedPathHash }
      : {};
    await writeAtomic(
      pathFor(targetId),
      `${JSON.stringify({
        ...currentState,
        formatVersion: 3
      }, null, 2)}\n`,
      writeOptions
    );
  };

  return { pathFor, read, write };
};
