import { describe, expect, it } from "vitest";
import { createProfileContentHash } from "../../src/main/profileFingerprint";
import type { ProfileDetail } from "../../src/shared/types";

const profile = (mode: "ignore" | "manage", enabled: boolean): ProfileDetail => ({
  id: "daily-coding",
  manifest: {
    id: "daily-coding",
    name: "Daily Coding",
    description: "",
    version: 2
  },
  instructions: "# Agent\n",
  resources: {
    skills: [],
    mcpByTarget: {
      codex: {
        mode,
        selections: [{ name: "context7", enabled }]
      }
    }
  },
  contentHash: "",
  targetContentHashes: {}
});

describe("Profile target fingerprint", () => {
  it("excludes retained MCP selections while the Target policy is ignore", () => {
    expect(createProfileContentHash(profile("ignore", true), "codex"))
      .toBe(createProfileContentHash(profile("ignore", false), "codex"));
  });

  it("includes MCP selections while the Target policy is manage", () => {
    expect(createProfileContentHash(profile("manage", true), "codex"))
      .not.toBe(createProfileContentHash(profile("manage", false), "codex"));
  });
});
