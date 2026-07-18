import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const id = process.argv[2];
if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
  throw new Error("Usage: npm run target:new -- <lowercase-target-id>");
}

const pascalName = id
  .split("-")
  .map((part) => part[0].toUpperCase() + part.slice(1))
  .join("");
const directory = join(process.cwd(), "src", "main", "targets", "integrations", id);
await mkdir(directory, { recursive: false });

const source = `import { join } from "node:path";
import { defineTargetIntegration } from "../../defineTargetIntegration";
import type { AgentTargetIntegration } from "../../contract";

export const ${pascalName}Integration: AgentTargetIntegration = {
  descriptor: {
    id: "${id}",
    name: "${pascalName}",
    description: "Manage ${pascalName} local agent configuration.",
    iconKey: "generic",
    instructionsLabel: "AGENTS.md",
    configLabel: "config.json",
    configLanguage: "jsonc",
    realWritesEnabled: false,
    executableName: "${id}",
    capabilities: {
      instructions: true,
      skills: true,
      mcpTransports: ["stdio"],
      disabledSkillPaths: false
    }
  },
  paths: {
    createTargetPaths: ({ homeDir }) => {
      const configDir = join(homeDir, ".config", "${id}");
      return {
        targetId: "${id}",
        configDir,
        instructionsPath: join(configDir, "AGENTS.md"),
        configPath: join(configDir, "config.json"),
        skillsDir: join(configDir, "skills")
      };
    }
  },
  profile: {
    createDefaultProfile: () => { throw new Error("Implement default Profile"); },
    captureProfile: async () => { throw new Error("Implement capture"); },
    readProfileFiles: async () => { throw new Error("Implement Profile read"); },
    writeProfileFiles: async () => { throw new Error("Implement Profile write"); }
  },
  config: {
    createPreview: async () => { throw new Error("Implement preview"); }
  },
  mcp: {
    materializeMcpRefs: (profile) => profile
  },
  assets: {
    validateAssets: async () => [],
    getAssetBackupPaths: async () => [],
    applyAssets: async () => undefined
  }
};

export const create${pascalName}TargetAdapter = () =>
  defineTargetIntegration(${pascalName}Integration);
`;

await writeFile(join(directory, "index.ts"), source, { flag: "wx" });
process.stdout.write(`Created ${directory}/index.ts\nAdd its adapter factory to integrations/index.ts, then complete the contract tests.\n`);
