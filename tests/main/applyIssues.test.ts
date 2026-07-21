import { describe, expect, it } from "vitest";
import {
  createApplyIssue,
  dedupeApplyIssues,
  replaceableApplyPaths
} from "../../src/main/applyIssues";

describe("Apply issues", () => {
  it("keeps separate logical MCP issues that share one native config file", () => {
    const path = "/home/.codex/config.toml";
    const issues = dedupeApplyIssues([
      createApplyIssue({
        code: "missing-native-mcp",
        disposition: "block",
        resolution: "edit-profile",
        resourceKind: "mcp",
        resourceId: "github",
        path,
        message: "github is missing"
      }),
      createApplyIssue({
        code: "missing-native-mcp",
        disposition: "block",
        resolution: "edit-profile",
        resourceKind: "mcp",
        resourceId: "postgres",
        path,
        message: "postgres is missing"
      })
    ]);

    expect(issues.map((issue) => issue.resourceId)).toEqual(["github", "postgres"]);
  });

  it("keeps the strongest issue for one physical resource identity", () => {
    const path = "/home/.codex/skills/reviewer";
    const issues = dedupeApplyIssues([
      createApplyIssue({
        code: "unmanaged-skill-preserved",
        disposition: "notice",
        resolution: "preserve",
        resourceKind: "skill",
        resourceId: "reviewer",
        path,
        message: "reviewer is preserved"
      }),
      createApplyIssue({
        code: "unmanaged-skill-replacement",
        disposition: "review",
        resolution: "backup-replace",
        resourceKind: "skill",
        resourceId: "reviewer",
        path,
        message: "reviewer will be replaced"
      })
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0].disposition).toBe("review");
    expect(replaceableApplyPaths(issues)).toEqual(new Set([path]));
  });
});
