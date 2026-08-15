import { z } from "zod";

const RelativeScenarioPathSchema = z.string().min(1).refine(
  (value) => {
    const normalized = value.replaceAll("\\", "/");
    return (
      !normalized.startsWith("/") &&
      !/^[a-zA-Z]:\//.test(normalized) &&
      !normalized.split("/").includes("..")
    );
  },
  { message: "Machine scenario paths must stay inside the synthetic home" }
);

const ScenarioPlatformSchema = z.enum(["darwin", "linux", "win32"]);

const ScenarioEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("directory"),
    path: RelativeScenarioPathSchema
  }),
  z.object({
    type: z.literal("file"),
    path: RelativeScenarioPathSchema,
    content: z.string().default("")
  }),
  z.object({
    type: z.literal("symlink"),
    path: RelativeScenarioPathSchema,
    target: z.string().min(1),
    linkKind: z.enum(["dir", "file", "junction"]).default("dir")
  })
]);

const ExpectedObservationSchema = z.object({
  runtimeName: z.string().min(1),
  deploymentName: z.string().min(1).optional(),
  locationRole: z.enum([
    "preferred-runtime",
    "alternate-runtime",
    "compatibility-runtime",
    "discovery-only"
  ]),
  availability: z.enum(["enabled", "disabled", "unknown"]).optional(),
  owner: z.enum(["agentenv", "agent", "external", "user"]).optional(),
  issueCodes: z.array(z.string().min(1)).default([])
});

const InstallationExpectationSchema = z.object({
  state: z.enum(["found", "missing"]),
  command: z.string().min(1),
  executablePath: RelativeScenarioPathSchema.optional()
});

export const MachineScenarioSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().min(1),
  targetId: z.enum([
    "opencode",
    "claude-code",
    "codex",
    "antigravity",
    "trae-cli",
    "pi"
  ]),
  platforms: z.array(ScenarioPlatformSchema).min(1).default([
    "darwin",
    "linux",
    "win32"
  ]),
  tags: z.array(z.string().min(1)).default([]),
  environment: z.record(z.string(), z.string()).default({}),
  entries: z.array(ScenarioEntrySchema).default([]),
  installation: InstallationExpectationSchema.optional(),
  expected: z.object({
    configPath: RelativeScenarioPathSchema,
    runtimeDir: RelativeScenarioPathSchema.optional(),
    observations: z.array(ExpectedObservationSchema).default([]),
    issueCodes: z.array(z.string().min(1)).default([])
  })
});

export const MachineScenarioCatalogSchema = z.object({
  formatVersion: z.literal(1),
  scenarios: z.array(MachineScenarioSchema).min(1).superRefine((scenarios, context) => {
    const seen = new Set<string>();
    for (const scenario of scenarios) {
      if (seen.has(scenario.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate machine scenario id: ${scenario.id}`
        });
      }
      seen.add(scenario.id);
    }
  })
});

export type MachineScenario = z.infer<typeof MachineScenarioSchema>;
export type MachineScenarioEntry = z.infer<typeof ScenarioEntrySchema>;
