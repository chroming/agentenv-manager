import { describe, expect, it } from "vitest";
import type {
  ProfileDetail,
  TargetInfo,
  TargetManagementState
} from "../../src/shared/types";
import {
  compareProfilesByCreationTime,
  findRecentProfileApplication,
  listProfileApplications,
  preferredTargetForProfile,
  summarizeProfile
} from "../../src/renderer/profileSummary";

const makeProfile = (overrides: Partial<ProfileDetail> = {}): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    targetId: "codex",
    name: "Daily coding",
    description: "",
    version: 1,
    managed: { instructions: true, config: true, assets: true }
  },
  instructions: "Use concise answers.\n",
  configText: "",
  assetPolicy: {
    ownedDirs: [],
    ownedFiles: [],
    skillRefs: [],
    mcpRefs: [],
    disabledSkillPaths: []
  },
  ...overrides
});

describe("profile summary", () => {
  it("sorts profiles by creation time without lifecycle state", () => {
    const profiles = [
      { id: "older", name: "A older", createdAt: "2026-07-15T00:00:00.000Z" },
      { id: "newer", name: "Z newer", createdAt: "2026-07-16T00:00:00.000Z" }
    ];

    expect([...profiles].sort(compareProfilesByCreationTime).map((profile) => profile.id)).toEqual([
      "newer",
      "older"
    ]);
  });

  it("summarizes instructions skills and MCP deterministically", () => {
    const profile = makeProfile({
      configText: `{
        // OpenCode uses the mcp table.
        "mcp": {
          "raw-search": { "type": "remote" },
          "shared-mcp": { "type": "local" }
        }
      }`,
      assetPolicy: {
        ownedDirs: [
          { kind: "skill", source: "skills/review", targetName: "profile-review" },
          { kind: "agent", source: "agents/helper", targetName: "helper" }
        ],
        ownedFiles: [
          { kind: "skill", source: "skills/debug.md", targetName: "profile-debug" }
        ],
        skillRefs: [
          { libraryId: "testing", targetName: "library-testing" },
          { libraryId: "review", targetName: "profile-review" },
          { libraryId: "paused", targetName: "paused-skill", enabled: false }
        ],
        mcpRefs: [
          { libraryId: "docs", targetName: "library-docs" },
          { libraryId: "shared", targetName: "shared-mcp" }
        ],
        disabledSkillPaths: []
      }
    });

    expect(summarizeProfile(profile, { id: "opencode", configLanguage: "jsonc" })).toEqual({
      instructions: { count: 1 },
      skills: {
        count: 3,
        names: ["profile-review", "profile-debug", "library-testing"]
      },
      mcp: {
        count: 3,
        names: ["library-docs", "shared-mcp", "raw-search"]
      }
    });
  });

  it("deduplicates names while preserving source order", () => {
    const profile = makeProfile({
      configText: `
        [mcp_servers.raw_first]
        command = "one"

        [mcp_servers."library-docs"]
        command = "two"

        [mcp_servers.raw_second]
        command = "three"
      `,
      assetPolicy: {
        ownedDirs: [
          { kind: "skill", source: "skills/alpha", targetName: "alpha" },
          { kind: "skill", source: "skills/alpha-copy", targetName: "alpha" }
        ],
        ownedFiles: [
          { kind: "skill", source: "skills/beta.md", targetName: "beta" }
        ],
        skillRefs: [
          { libraryId: "beta", targetName: "beta" },
          { libraryId: "gamma", targetName: "gamma" }
        ],
        mcpRefs: [
          { libraryId: "docs", targetName: "library-docs" },
          { libraryId: "docs-copy", targetName: "library-docs" }
        ],
        disabledSkillPaths: []
      }
    });

    expect(summarizeProfile(profile, { id: "codex", configLanguage: "toml" })).toMatchObject({
      skills: { count: 3, names: ["alpha", "beta", "gamma"] },
      mcp: {
        count: 3,
        names: ["library-docs", "raw_first", "raw_second"]
      }
    });
  });

  it("supports JSONC mcpServers and ignores empty or unmanaged instructions", () => {
    const profile = makeProfile({
      instructions: "   \n",
      configText: `{
        "mcpServers": {
          "context7": { "command": "npx" },
          "docs": { "url": "https://example.com" }
        }
      }`
    });

    expect(
      summarizeProfile(profile, { id: "claude-code", configLanguage: "jsonc" })
    ).toMatchObject({
      instructions: { count: 0 },
      mcp: { count: 2, names: ["context7", "docs"] }
    });

    const unmanagedInstructions = makeProfile({
      manifest: {
        ...profile.manifest,
        managed: { ...profile.manifest.managed, instructions: false }
      },
      instructions: "Nonempty but unmanaged"
    });
    expect(
      summarizeProfile(unmanagedInstructions, {
        id: "claude-code",
        configLanguage: "jsonc"
      }).instructions.count
    ).toBe(0);
  });

  it("uses only the raw MCP property owned by the selected target", () => {
    const profile = makeProfile({
      configText: `{
        "mcp": {
          "opencode-search": { "type": "remote" }
        },
        "mcpServers": {
          "claude-docs": { "command": "npx" }
        }
      }`
    });

    expect(
      summarizeProfile(profile, { id: "opencode", configLanguage: "jsonc" }).mcp
    ).toEqual({ count: 1, names: ["opencode-search"] });
    expect(
      summarizeProfile(profile, { id: "claude-code", configLanguage: "jsonc" }).mcp
    ).toEqual({ count: 1, names: ["claude-docs"] });
  });

  it("finds the newest matching target application", () => {
    const states = [
      {
        targetId: "opencode",
        activeProfileId: "daily-coding",
        lastAppliedAt: "2026-07-09T08:00:00.000Z"
      },
      {
        targetId: "codex",
        activeProfileId: "daily-coding",
        lastAppliedAt: "2026-07-10T08:00:00.000Z"
      },
      {
        targetId: "claude-code",
        activeProfileId: "other-profile",
        lastAppliedAt: "2026-07-11T08:00:00.000Z"
      }
    ] as TargetManagementState[];
    const targets = [
      { id: "codex", name: "Codex" },
      { id: "opencode", name: "OpenCode" }
    ] as TargetInfo[];

    expect(findRecentProfileApplication("daily-coding", states, targets)).toEqual({
      state: states[1],
      target: targets[0]
    });
    expect(findRecentProfileApplication("missing", states, targets)).toBeUndefined();
  });

  it("lists every active target even when application time is unavailable", () => {
    const states = [
      {
        targetId: "opencode",
        activeProfileId: "daily-coding"
      },
      {
        targetId: "codex",
        activeProfileId: "daily-coding",
        lastAppliedAt: "2026-07-10T08:00:00.000Z"
      },
      {
        targetId: "claude-code",
        activeProfileId: "other-profile"
      }
    ] as TargetManagementState[];
    const targets = [
      { id: "opencode", name: "OpenCode" },
      { id: "codex", name: "Codex" },
      { id: "claude-code", name: "Claude Code" }
    ] as TargetInfo[];

    expect(listProfileApplications("daily-coding", states, targets)).toEqual([
      { state: states[1], target: targets[1] },
      { state: states[0], target: targets[0] }
    ]);
  });

  it("keeps apply target context scoped to each profile", () => {
    const targets = [
      { id: "opencode", name: "OpenCode", health: { executableFound: true } },
      { id: "codex", name: "Codex", health: { executableFound: true } },
      { id: "claude-code", name: "Claude Code", health: { executableFound: true } }
    ] as TargetInfo[];
    const states = [
      {
        targetId: "codex",
        activeProfileId: "daily-coding",
        lastAppliedAt: "2026-07-10T08:00:00.000Z"
      }
    ] as TargetManagementState[];

    expect(
      preferredTargetForProfile("daily-coding", "opencode", states, targets, "claude-code")
    ).toBe("claude-code");
    expect(preferredTargetForProfile("daily-coding", "opencode", states, targets)).toBe(
      "codex"
    );
    expect(preferredTargetForProfile("new-profile", "opencode", states, targets)).toBe(
      "opencode"
    );
  });
});
