import { describe, expect, it } from "vitest";
import { createProjectCapability } from "../../../src/main/projects/projectCapability";

describe("Project capability", () => {
  it("keeps categorized declarations explicit while exposing stable Compare paths", () => {
    const capability = createProjectCapability({
      support: {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "partial", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      instructionFiles: ["AGENTS.md"],
      instructionCreateFile: "AGENTS.md",
      skillLocations: [{
        relativePath: ".agents/skills",
        scope: "shared",
        writable: true,
        priority: 100
      }],
      mcpFiles: ["agent.json"],
      compareResourcePaths: ["AGENTS.md", ".agents", "agent.json", ".agents"]
    });

    expect(capability.instructionFiles).toEqual(["AGENTS.md"]);
    expect(capability.instructionCreateFile).toBe("AGENTS.md");
    expect(capability.skillLocations).toEqual([{
      relativePath: ".agents/skills",
      scope: "shared",
      writable: true,
      priority: 100
    }]);
    expect(capability.mcpFiles).toEqual(["agent.json"]);
    expect(capability.compareResourcePaths).toEqual([
      "AGENTS.md",
      ".agents",
      "agent.json"
    ]);
  });

  it("rejects a Project instruction create target that cannot be inspected", () => {
    expect(() => createProjectCapability({
      support: {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "unsupported", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      instructionFiles: ["AGENTS.md"],
      instructionCreateFile: "CLAUDE.md",
      skillLocations: [{ relativePath: ".agents/skills", scope: "shared", writable: true, priority: 100 }],
      mcpFiles: [],
      compareResourcePaths: ["AGENTS.md", ".agents"]
    })).toThrow("must also be declared for inspection");
  });

  it("launches in the real Project directory only when the executable exists", () => {
    const capability = createProjectCapability({
      support: {
        instructions: { inspect: "supported", mutate: "supported" },
        skills: { inspect: "supported", mutate: "supported" },
        mcp: { inspect: "unsupported", mutate: "unsupported" },
        effectivePreview: "partial",
        cliLaunch: "supported"
      },
      instructionFiles: ["AGENTS.md"],
      skillLocations: [{ relativePath: ".agents/skills", scope: "shared", writable: true, priority: 100 }],
      mcpFiles: [],
      compareResourcePaths: ["AGENTS.md", ".agents"],
      launchArgs: ["interactive"]
    });

    expect(capability.createLaunchSpec({
      executablePath: undefined,
      projectRoot: "/workspace/example"
    })).toBeUndefined();
    expect(capability.createLaunchSpec({
      executablePath: "/usr/local/bin/agent",
      projectRoot: "/workspace/example"
    })).toEqual({
      executablePath: "/usr/local/bin/agent",
      args: ["interactive"],
      cwd: "/workspace/example"
    });
  });
});
