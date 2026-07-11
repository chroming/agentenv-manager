import { describe, expect, it } from "vitest";
import { collectLibraryResourceVersions } from "../../src/shared/libraryVersions";
import type { McpLibraryEntry, ProfileDetail, SkillLibraryEntry } from "../../src/shared/types";

describe("library resource versions", () => {
  it("tracks only enabled profile skill references", () => {
    const profile = {
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [
          { libraryId: "enabled", targetName: "enabled" },
          { libraryId: "disabled", targetName: "disabled", enabled: false }
        ],
        mcpRefs: [{ libraryId: "docs", targetName: "docs" }],
        disabledSkillPaths: []
      }
    } as Pick<ProfileDetail, "assetPolicy">;
    const skills = [
      { id: "enabled", contentHash: "enabled-hash" },
      { id: "disabled", contentHash: "disabled-hash" }
    ] as SkillLibraryEntry[];
    const mcpServers = [
      { id: "docs", name: "Docs", transport: "http", url: "https://example.com/mcp" }
    ] as McpLibraryEntry[];

    expect(collectLibraryResourceVersions(profile, skills, mcpServers)).toEqual({
      skills: { enabled: "enabled-hash" },
      mcp: {
        docs: JSON.stringify({
          transport: "http",
          command: "",
          args: [],
          url: "https://example.com/mcp",
          env: {}
        })
      }
    });
  });
});
