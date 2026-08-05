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
      skillDirectories: [".agents/skills"],
      mcpFiles: ["agent.json"],
      compareResourcePaths: ["AGENTS.md", ".agents", "agent.json", ".agents"]
    });

    expect(capability.instructionFiles).toEqual(["AGENTS.md"]);
    expect(capability.skillDirectories).toEqual([".agents/skills"]);
    expect(capability.mcpFiles).toEqual(["agent.json"]);
    expect(capability.compareResourcePaths).toEqual([
      "AGENTS.md",
      ".agents",
      "agent.json"
    ]);
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
      skillDirectories: [".agents/skills"],
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
