import { rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { SafeIdSchema } from "../shared/schemas";
import { writeAtomic } from "./fileUtils";
import type { AgentEnvPaths } from "./paths";

const CaptureSkillCopySchema = z.object({
  path: z.string().min(1),
  contentHash: z.string().min(1),
  locationRole: z.string().optional(),
  sharedLocation: z.boolean().optional()
});

const CaptureSkillReceiptSchema = z.object({
  libraryId: SafeIdSchema,
  targetName: z.string().min(1),
  copies: z.array(CaptureSkillCopySchema).min(1)
});

const CaptureReceiptSchema = z.object({
  formatVersion: z.literal(1),
  profileId: SafeIdSchema,
  targetId: SafeIdSchema,
  createdAt: z.string().datetime(),
  skills: z.array(CaptureSkillReceiptSchema)
});

export type CaptureReceipt = z.infer<typeof CaptureReceiptSchema>;
export type CaptureSkillCopy = z.infer<typeof CaptureSkillCopySchema>;

const receiptPath = (paths: AgentEnvPaths, profileId: string, targetId: string) =>
  join(
    paths.captureReceiptsDir,
    `${SafeIdSchema.parse(profileId)}--${SafeIdSchema.parse(targetId)}.json`
  );

export const createCaptureReceiptStore = (paths: AgentEnvPaths) => ({
  read: async (profileId: string, targetId: string): Promise<CaptureReceipt | undefined> => {
    try {
      const parsed = CaptureReceiptSchema.safeParse(
        JSON.parse(await readFile(receiptPath(paths, profileId, targetId), "utf8"))
      );
      return parsed.success &&
        parsed.data.profileId === profileId &&
        parsed.data.targetId === targetId
        ? parsed.data
        : undefined;
    } catch {
      return undefined;
    }
  },
  write: async (receipt: CaptureReceipt): Promise<void> => {
    const parsed = CaptureReceiptSchema.parse(receipt);
    await writeAtomic(
      receiptPath(paths, parsed.profileId, parsed.targetId),
      `${JSON.stringify(parsed, null, 2)}\n`
    );
  },
  remove: async (profileId: string, targetId: string): Promise<void> => {
    await rm(receiptPath(paths, profileId, targetId), { force: true });
  }
});
