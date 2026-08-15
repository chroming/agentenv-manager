import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const UpgradePathSchema = z.string().min(1).refine(
  (path) => {
    const normalized = path.replaceAll("\\", "/");
    return (
      !normalized.startsWith("/") &&
      !/^[a-zA-Z]:\//.test(normalized) &&
      !normalized.split("/").includes("..")
    );
  },
  { message: "Upgrade fixture paths must stay inside the data root" }
);

const EntrySchema = z.object({
  path: UpgradePathSchema,
  content: z.string()
});

const ExpectedSchema = z.object({
  outcome: z.enum(["success", "failure"]),
  migrated: z.boolean().optional(),
  profileCount: z.number().int().nonnegative().optional(),
  retainedProfileCount: z.number().int().nonnegative().optional(),
  manifestVersion: z.number().int().positive().optional(),
  preserved: z.array(EntrySchema).default([]),
  absent: z.array(UpgradePathSchema).default([]),
  jsonMatches: z.array(z.object({
    path: UpgradePathSchema,
    value: z.record(z.string(), z.unknown())
  })).default([]),
  reportContains: z.string().optional(),
  errorIncludes: z.string().optional(),
  exactOriginalTree: z.boolean().default(false)
});

const CatalogSchema = z.object({
  formatVersion: z.literal(1),
  scenarios: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    description: z.string().min(1),
    entries: z.array(EntrySchema),
    expected: ExpectedSchema
  })).min(1)
});

const fixturePath = fileURLToPath(
  new URL("../fixtures/app-data/upgrade-matrix.json", import.meta.url)
);

export const loadAppDataUpgradeScenarios = async () =>
  CatalogSchema.parse(JSON.parse(await readFile(fixturePath, "utf8"))).scenarios;
