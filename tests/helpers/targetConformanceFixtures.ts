import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ProfileMcpPolicy,
  ProfileResources
} from "../../src/shared/schemas";
import type { TargetPaths } from "../../src/shared/types";

export type BuiltInTargetId =
  | "opencode"
  | "claude-code"
  | "codex"
  | "antigravity"
  | "trae-cli"
  | "pi";

export interface TargetConformanceFixture {
  targetId: BuiltInTargetId;
  targetName: string;
  executableName: string;
  supportsMcpActivation: boolean;
  setupNativeState(
    homeDir: string,
    targetPaths: TargetPaths,
    options?: { includeSkill?: boolean }
  ): Promise<{
    preservedFiles: Map<string, string>;
    preservedFragments?: Map<string, string[]>;
  }>;
  mcpPolicy(profile: "alpha" | "beta"): ProfileMcpPolicy;
}

const writeText = async (path: string, content: string) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
};

const setupSkill = async (targetPaths: TargetPaths) => {
  if (!targetPaths.skillsDir) throw new Error(`${targetPaths.targetId} has no Skills directory`);
  await writeText(
    join(targetPaths.skillsDir, "existing", "SKILL.md"),
    "---\nname: existing\ndescription: Existing Agent Skill.\n---\n# Existing\n"
  );
};

const preserved = async (...paths: string[]) =>
  new Map(await Promise.all(paths.map(async (path) => [path, await readFile(path, "utf8")] as const)));

const ignoreMcp = (): ProfileMcpPolicy => ({ mode: "ignore", selections: [] });
const managedMcp = (profile: "alpha" | "beta"): ProfileMcpPolicy => ({
  mode: "manage",
  selections: [
    { name: "alpha", enabled: profile === "alpha" },
    { name: "beta", enabled: profile === "beta" }
  ]
});

export const targetConformanceFixtures: readonly TargetConformanceFixture[] = [
  {
    targetId: "opencode",
    targetName: "OpenCode",
    executableName: "opencode",
    supportsMcpActivation: true,
    mcpPolicy: managedMcp,
    setupNativeState: async (_homeDir, targetPaths, options) => {
      await writeText(targetPaths.instructionsPath, "# Existing OpenCode\n");
      await writeText(
        targetPaths.configPath,
        [
          "{",
          "  // Agent-owned settings must survive",
          '  "username": "local-user",',
          '  "mcp": {',
          '    "alpha": { "type": "local", "command": ["alpha"], "enabled": false },',
          '    "beta": { "type": "local", "command": ["beta"], "enabled": true }',
          "  }",
          "}",
          ""
        ].join("\n")
      );
      if (options?.includeSkill) await setupSkill(targetPaths);
      return {
        preservedFiles: new Map(),
        preservedFragments: new Map([
          [targetPaths.configPath, ['"username": "local-user"']]
        ])
      };
    }
  },
  {
    targetId: "claude-code",
    targetName: "Claude Code",
    executableName: "claude",
    supportsMcpActivation: false,
    mcpPolicy: ignoreMcp,
    setupNativeState: async (homeDir, targetPaths, options) => {
      const mcpPath = targetPaths.mcpConfigPath ?? join(homeDir, ".claude.json");
      await writeText(targetPaths.instructionsPath, "# Existing Claude\n");
      await writeText(
        targetPaths.configPath,
        '{\n  "permissions": { "defaultMode": "bypassPermissions" },\n  "env": { "TOKEN": "keep" }\n}\n'
      );
      await writeText(
        mcpPath,
        '{\n  "mcpServers": { "docs": { "command": "docs" } },\n  "projects": {}\n}\n'
      );
      if (options?.includeSkill) await setupSkill(targetPaths);
      return { preservedFiles: await preserved(targetPaths.configPath, mcpPath) };
    }
  },
  {
    targetId: "codex",
    targetName: "Codex",
    executableName: "codex",
    supportsMcpActivation: true,
    mcpPolicy: managedMcp,
    setupNativeState: async (_homeDir, targetPaths, options) => {
      await writeText(targetPaths.instructionsPath, "# Existing Codex\n");
      await writeText(
        targetPaths.configPath,
        [
          'model = "gpt-5"',
          'approval_policy = "on-request"',
          "",
          "[mcp_servers.alpha]",
          'command = "alpha"',
          "enabled = false",
          "",
          "[mcp_servers.beta]",
          'command = "beta"',
          "enabled = true",
          ""
        ].join("\n")
      );
      if (options?.includeSkill) await setupSkill(targetPaths);
      return {
        preservedFiles: new Map(),
        preservedFragments: new Map([
          [targetPaths.configPath, ['model = "gpt-5"', 'approval_policy = "on-request"']]
        ])
      };
    }
  },
  {
    targetId: "antigravity",
    targetName: "Antigravity CLI",
    executableName: "agy",
    supportsMcpActivation: false,
    mcpPolicy: ignoreMcp,
    setupNativeState: async (_homeDir, targetPaths, options) => {
      await writeText(targetPaths.instructionsPath, "# Existing Antigravity\n");
      await writeText(
        targetPaths.configPath,
        '{\n  "mcpServers": { "private": { "command": "private" } }\n}\n'
      );
      if (options?.includeSkill) await setupSkill(targetPaths);
      return { preservedFiles: await preserved(targetPaths.configPath) };
    }
  },
  {
    targetId: "trae-cli",
    targetName: "Trae CLI",
    executableName: "traecli",
    supportsMcpActivation: true,
    mcpPolicy: managedMcp,
    setupNativeState: async (homeDir, targetPaths, options) => {
      await writeText(targetPaths.instructionsPath, "# Existing Trae\n");
      await writeText(
        targetPaths.configPath,
        [
          'model = "fast"',
          "",
          "[mcp_servers.alpha]",
          'command = "alpha"',
          "enabled = false",
          "",
          "[mcp_servers.alpha.env]",
          'TOKEN = "keep-trae-secret"',
          "",
          "[mcp_servers.beta]",
          'url = "https://example.test/beta"',
          "enabled = true",
          ""
        ].join("\n")
      );
      const authPath = join(targetPaths.runtimeDir ?? join(homeDir, ".trae", "cli"), "auth.json");
      await writeText(authPath, '{"token":"runtime-owned"}\n');
      if (options?.includeSkill) await setupSkill(targetPaths);
      return {
        preservedFiles: await preserved(authPath),
        preservedFragments: new Map([
          [targetPaths.configPath, ['model = "fast"', 'TOKEN = "keep-trae-secret"']]
        ])
      };
    }
  },
  {
    targetId: "pi",
    targetName: "Pi",
    executableName: "pi",
    supportsMcpActivation: false,
    mcpPolicy: ignoreMcp,
    setupNativeState: async (_homeDir, targetPaths, options) => {
      await writeText(targetPaths.instructionsPath, "# Existing Pi\n");
      await writeText(
        targetPaths.configPath,
        '{\n  "theme": "dark",\n  "provider": { "token": "pi-owned-secret" }\n}\n'
      );
      if (options?.includeSkill) await setupSkill(targetPaths);
      return { preservedFiles: await preserved(targetPaths.configPath) };
    }
  }
] as const;

export const profileResourcesFor = (
  fixture: TargetConformanceFixture,
  profile: "alpha" | "beta",
  options: { instructions?: "ignore" | "manage" | "disable"; skills?: "ignore" | "manage" | "disable" } = {}
): ProfileResources => ({
  skills: [{ libraryId: profile, targetName: profile, enabled: true }],
  managementByTarget: {
    [fixture.targetId]: {
      instructions: options.instructions ?? "manage",
      skills: options.skills ?? "manage"
    }
  },
  mcpByTarget: {
    [fixture.targetId]: fixture.mcpPolicy(profile)
  }
});
