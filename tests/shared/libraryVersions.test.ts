import { describe, expect, it } from "vitest";
import { collectLibraryResourceVersions } from "../../src/shared/libraryVersions";
import type { McpLibraryEntry, ProfileDetail, SkillLibraryEntry } from "../../src/shared/types";

describe("library resource versions", () => {
  it("tracks only Profile-enabled and globally enabled skill references", () => {
    const profile = {
      assetPolicy: {
        ownedDirs: [],
        ownedFiles: [],
        skillRefs: [
          { libraryId: "enabled", targetName: "enabled" },
          { libraryId: "profile-disabled", targetName: "profile-disabled", enabled: false },
          { libraryId: "global-disabled", targetName: "global-disabled" }
        ],
        mcpRefs: [{ libraryId: "docs", targetName: "docs" }],
        disabledSkillPaths: []
      }
    } as Pick<ProfileDetail, "assetPolicy">;
    const skills = [
      { id: "enabled", contentHash: "enabled-hash" },
      { id: "profile-disabled", contentHash: "profile-disabled-hash" },
      { id: "global-disabled", contentHash: "global-disabled-hash", globallyEnabled: false }
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
