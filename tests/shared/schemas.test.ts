import { describe, expect, it } from "vitest";
import {
  ProfileManifestSchema,
  ProfileResourcesSchema,
  ProjectReferenceSchema
} from "../../src/shared/schemas";

describe("Profile v2 schemas", () => {
  it("accepts portable metadata and target-specific MCP policies", () => {
    expect(ProfileManifestSchema.parse({
      id: "daily-coding",
      preferredTargetId: "opencode",
      name: "Daily Coding",
      description: "Default coding environment.",
      iconKey: "rocket",
      version: 2
    }).id).toBe("daily-coding");

    expect(ProfileResourcesSchema.parse({
      skills: [
        { libraryId: "review", targetName: "review", enabled: true },
        { libraryId: "paused", targetName: "paused", enabled: false }
      ],
      mcpByTarget: {
        codex: {
          mode: "manage",
          selections: [
            { name: "docs", enabled: true },
            { name: "optional", enabled: false }
          ]
        },
        opencode: { mode: "ignore", selections: [] },
        trae: { mode: "disable", selections: [{ name: "docs", enabled: true }] }
      }
    })).toMatchObject({ skills: [{ enabled: true }, { enabled: false }] });
  });

  it("rejects v1 manifests, unsafe ids, and unknown icons", () => {
    expect(() => ProfileManifestSchema.parse({
      id: "daily-coding",
      targetId: "opencode",
      name: "Old",
      description: "",
      version: 1
    })).toThrow();
    expect(() => ProfileManifestSchema.parse({
      id: "../bad",
      name: "Bad",
      description: "",
      version: 2
    })).toThrow();
    expect(() => ProfileManifestSchema.parse({
      id: "daily-coding",
      name: "Bad icon",
      description: "",
      iconKey: "random-icon",
      version: 2
    })).toThrow();
  });

  it("rejects duplicate Skill identities, install names, and MCP selections", () => {
    expect(() => ProfileResourcesSchema.parse({
      skills: [
        { libraryId: "review", targetName: "review", enabled: true },
        { libraryId: "review", targetName: "review-copy", enabled: true }
      ]
    })).toThrow("referenced more than once");
    expect(() => ProfileResourcesSchema.parse({
      skills: [
        { libraryId: "review", targetName: "review", enabled: true },
        { libraryId: "docs", targetName: "review", enabled: true }
      ]
    })).toThrow("declared more than once");
    expect(() => ProfileResourcesSchema.parse({
      mcpByTarget: {
        codex: {
          mode: "manage",
          selections: [
            { name: "docs", enabled: true },
            { name: "docs", enabled: false }
          ]
        }
      }
    })).toThrow("declared more than once");
  });
});

describe("Project reference schema", () => {
  it("accepts bounded device-local reference metadata", () => {
    expect(ProjectReferenceSchema.parse({
      id: "project-1",
      name: "AgentEnv Manager",
      rootPath: "/Users/example/Github/agentenv-manager",
      createdAt: "2026-08-06T00:00:00.000Z",
      lastAgentId: "codex"
    })).toMatchObject({ id: "project-1", lastAgentId: "codex" });
  });

  it("rejects empty names and unbounded metadata", () => {
    expect(() => ProjectReferenceSchema.parse({
      id: "project-1",
      name: "",
      rootPath: "/tmp/project",
      createdAt: "2026-08-06T00:00:00.000Z"
    })).toThrow();
    expect(() => ProjectReferenceSchema.parse({
      id: "project-1",
      name: "Project",
      rootPath: "/tmp/project",
      createdAt: "2026-08-06T00:00:00.000Z",
      arbitrary: true
    })).toThrow();
  });
});
