import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { SafeIdSchema } from "../shared/schemas";
import type {
  ManagedSharedSkillReceipt,
  SharedSkillAreaMode,
  SharedSkillAreaState
} from "../shared/types";
import { writeAtomic } from "./fileUtils";
import type { AgentEnvPaths } from "./paths";

const SharedSkillAreaStateSchema = z.object({
  formatVersion: z.literal(1),
  mode: z.enum(["keep", "managed", "profiles-only"]).optional(),
  receipts: z.array(z.object({
    path: z.string().min(1),
    sharedLocationId: z.literal("agents-skills"),
    libraryId: SafeIdSchema,
    adoptedContentHash: z.string().min(1),
    materialization: z.enum(["linked", "copied"]),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1)
  }))
});

const EMPTY_SHARED_SKILL_AREA_STATE: SharedSkillAreaState = {
  formatVersion: 1,
  receipts: []
};

const isMissingFileError = (error: unknown) =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");

const normalizedState = (value: unknown): SharedSkillAreaState => {
  const parsed = SharedSkillAreaStateSchema.parse(value);
  const receipts = new Map<string, ManagedSharedSkillReceipt>();
  for (const receipt of parsed.receipts) {
    const path = resolve(receipt.path);
    if (receipts.has(path)) {
      throw new Error(`Shared Skill management has duplicate receipts for ${path}`);
    }
    receipts.set(path, { ...receipt, path });
  }
  return { ...parsed, receipts: [...receipts.values()].sort((a, b) => a.path.localeCompare(b.path)) };
};

export const parseSharedSkillAreaState = normalizedState;

export interface SharedSkillAreaStore {
  readonly path: string;
  read(): Promise<SharedSkillAreaState>;
  setMode(mode: SharedSkillAreaMode): Promise<SharedSkillAreaState>;
  recordManaged(
    receipts: Array<Omit<ManagedSharedSkillReceipt, "createdAt" | "updatedAt">>
  ): Promise<SharedSkillAreaState>;
  removeManaged(paths: readonly string[]): Promise<SharedSkillAreaState>;
}

export const createSharedSkillAreaStore = (paths: AgentEnvPaths): SharedSkillAreaStore => {
  const read = async (): Promise<SharedSkillAreaState> => {
    try {
      return normalizedState(JSON.parse(await readFile(paths.sharedSkillAreaStatePath, "utf8")));
    } catch (error) {
      if (isMissingFileError(error)) return EMPTY_SHARED_SKILL_AREA_STATE;
      throw error;
    }
  };

  const write = async (next: SharedSkillAreaState) => {
    const normalized = normalizedState(next);
    const content = `${JSON.stringify(normalized, null, 2)}\n`;
    const current = await readFile(paths.sharedSkillAreaStatePath, "utf8").catch((error) => {
      if (isMissingFileError(error)) return undefined;
      throw error;
    });
    if (current !== content) await writeAtomic(paths.sharedSkillAreaStatePath, content);
    return normalized;
  };

  const setMode = async (mode: SharedSkillAreaMode) => {
    const current = await read();
    return write({
      ...current,
      mode,
      receipts: mode === "managed" ? current.receipts : []
    });
  };

  const recordManaged: SharedSkillAreaStore["recordManaged"] = async (incoming) => {
    const current = await read();
    const now = new Date().toISOString();
    const receipts = new Map(current.receipts.map((receipt) => [resolve(receipt.path), receipt]));
    for (const item of incoming) {
      const path = resolve(item.path);
      const existing = receipts.get(path);
      receipts.set(path, {
        ...item,
        path,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
    }
    return write({
      formatVersion: 1,
      mode: current.mode === "profiles-only" ? "profiles-only" : "managed",
      receipts: [...receipts.values()]
    });
  };

  const removeManaged = async (removedPaths: readonly string[]) => {
    const current = await read();
    const removed = new Set(removedPaths.map((path) => resolve(path)));
    return write({
      ...current,
      receipts: current.receipts.filter((receipt) => !removed.has(resolve(receipt.path)))
    });
  };

  return { path: paths.sharedSkillAreaStatePath, read, setMode, recordManaged, removeManaged };
};
