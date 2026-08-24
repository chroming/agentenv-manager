import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  InstructionBlockMetadataSchema,
  SafeIdSchema,
  type InstructionBlockMetadata
} from "../shared/schemas";
import type {
  CreateInstructionBlockInput,
  InstructionBlock,
  RemoveInstructionBlockInput,
  UpdateInstructionBlockInput
} from "../shared/types";
import { joinInstructionContents } from "../shared/profileInstructions";
import { findSecretWarnings } from "./secretWarnings";
import {
  isMissingFileError,
  replacePathAtomically,
  syncParentDirectory,
  writeAtomic
} from "./fileUtils";
import type { AgentEnvPaths } from "./paths";

const METADATA_FILE = "instruction.json";
const CONTENT_FILE = "CONTENT.md";

const contentHashFor = (metadata: InstructionBlockMetadata, content: string) =>
  createHash("sha256")
    .update(JSON.stringify({
      name: metadata.name,
      description: metadata.description,
      iconKey: metadata.iconKey,
      content
    }))
    .digest("hex");

const slugName = (name: string) => {
  const slug = name.trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return SafeIdSchema.safeParse(slug).success ? slug : "instruction";
};

const validateContent = (content: string) => {
  if (content.length > 2_000_000) throw new Error("Instruction content is too large");
  const warnings = findSecretWarnings(content);
  if (warnings.length > 0) {
    throw new Error(`Instruction content may contain credentials: ${warnings[0]}`);
  }
};

export interface InstructionLibraryStore {
  list(): Promise<InstructionBlock[]>;
  read(id: string): Promise<InstructionBlock>;
  create(input: CreateInstructionBlockInput): Promise<InstructionBlock>;
  update(input: UpdateInstructionBlockInput): Promise<InstructionBlock>;
  remove(input: RemoveInstructionBlockInput): Promise<void>;
  ensureProfileInstruction(input: {
    profileId: string;
    profileName: string;
    content: string;
  }): Promise<{ block: InstructionBlock; created: boolean }>;
  resolve(ids: readonly string[]): Promise<InstructionBlock[]>;
  compile(ids: readonly string[], inlineContent: string): Promise<string>;
}

export const createInstructionLibraryStore = (
  paths: Pick<AgentEnvPaths, "appDataRoot" | "instructionsLibraryDir">
): InstructionLibraryStore => {
  const blockRoot = (id: string) => join(paths.instructionsLibraryDir, SafeIdSchema.parse(id));

  const read = async (id: string): Promise<InstructionBlock> => {
    const root = blockRoot(id);
    const stats = await lstat(root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Instruction Block storage must be a real directory: ${id}`);
    }
    const [metadata, content] = await Promise.all([
      readFile(join(root, METADATA_FILE), "utf8").then((value) =>
        InstructionBlockMetadataSchema.parse(JSON.parse(value))
      ),
      readFile(join(root, CONTENT_FILE), "utf8")
    ]);
    if (metadata.id !== id) throw new Error(`Instruction Block directory and metadata differ: ${id}`);
    return {
      ...metadata,
      content,
      contentHash: contentHashFor(metadata, content),
      path: join(root, CONTENT_FILE)
    };
  };

  const list = async () => {
    const entries = await readdir(paths.instructionsLibraryDir, { withFileTypes: true })
      .catch((error) => {
        if (isMissingFileError(error)) return [];
        throw error;
      });
    const blocks: InstructionBlock[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      blocks.push(await read(entry.name));
    }
    return blocks.sort((left, right) => left.name.localeCompare(right.name));
  };

  const create = async (input: CreateInstructionBlockInput) => {
    validateContent(input.content);
    const now = new Date().toISOString();
    const id = `${slugName(input.name)}-${randomUUID().slice(0, 8)}`;
    const metadata = InstructionBlockMetadataSchema.parse({
      formatVersion: 1,
      id,
      name: input.name,
      description: input.description ?? "",
      iconKey: input.iconKey,
      createdAt: now,
      updatedAt: now
    });
    await mkdir(paths.instructionsLibraryDir, { recursive: true, mode: 0o700 });
    await replacePathAtomically(blockRoot(id), async (stagingDir) => {
      await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      await Promise.all([
        writeAtomic(join(stagingDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`),
        writeAtomic(join(stagingDir, CONTENT_FILE), input.content)
      ]);
    });
    return read(id);
  };

  const ensureProfileInstruction: InstructionLibraryStore["ensureProfileInstruction"] = async (
    input
  ) => {
    validateContent(input.content);
    const id = `profile-${createHash("sha256").update(input.profileId).digest("hex").slice(0, 12)}-${
      createHash("sha256").update(input.content).digest("hex").slice(0, 12)
    }`;
    try {
      const existing = await read(id);
      if (existing.content !== input.content) {
        throw new Error(`Migrated Instruction ${id} does not match its Profile content`);
      }
      return { block: existing, created: false };
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }

    const now = new Date().toISOString();
    const metadata = InstructionBlockMetadataSchema.parse({
      formatVersion: 1,
      id,
      name: `${input.profileName} instructions`,
      description: `Reusable instructions for ${input.profileName}`,
      createdAt: now,
      updatedAt: now
    });
    await mkdir(paths.instructionsLibraryDir, { recursive: true, mode: 0o700 });
    await replacePathAtomically(blockRoot(id), async (stagingDir) => {
      await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      await Promise.all([
        writeAtomic(join(stagingDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`),
        writeAtomic(join(stagingDir, CONTENT_FILE), input.content)
      ]);
    });
    return { block: await read(id), created: true };
  };

  const update = async (input: UpdateInstructionBlockInput) => {
    validateContent(input.content);
    const current = await read(input.id);
    if (current.contentHash !== input.expectedContentHash) {
      throw new Error(`${current.name} changed since it was opened`);
    }
    const metadata = InstructionBlockMetadataSchema.parse({
      formatVersion: 1,
      id: current.id,
      name: input.name,
      description: input.description ?? "",
      iconKey: input.iconKey ?? current.iconKey,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    await replacePathAtomically(blockRoot(input.id), async (stagingDir) => {
      await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      await Promise.all([
        writeAtomic(join(stagingDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`),
        writeAtomic(join(stagingDir, CONTENT_FILE), input.content)
      ]);
    });
    return read(input.id);
  };

  const remove = async (input: RemoveInstructionBlockInput) => {
    const current = await read(input.id);
    if (current.contentHash !== input.expectedContentHash) {
      throw new Error(`${current.name} changed since deletion was prepared`);
    }
    const trashRoot = join(paths.appDataRoot, "trash", "instructions");
    await mkdir(trashRoot, { recursive: true, mode: 0o700 });
    await rename(
      blockRoot(input.id),
      join(trashRoot, `${input.id}-${Date.now()}-${randomUUID().slice(0, 8)}`)
    );
    await Promise.all([
      syncParentDirectory(paths.instructionsLibraryDir),
      syncParentDirectory(trashRoot)
    ]);
  };

  const resolve = async (ids: readonly string[]) => Promise.all(ids.map(read));

  return {
    list,
    read,
    create,
    update,
    remove,
    ensureProfileInstruction,
    resolve,
    compile: async (ids, inlineContent) => {
      const blocks = await resolve(ids);
      return joinInstructionContents([...blocks.map((block) => block.content), inlineContent]);
    }
  };
};
