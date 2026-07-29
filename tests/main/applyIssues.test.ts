import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  APPLY_ISSUE_POLICY,
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
        resourceKind: "mcp",
        resourceId: "github",
        path,
        message: "github is missing"
      }),
      createApplyIssue({
        code: "missing-native-mcp",
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
        code: "kept-outside-skill",
        resourceKind: "skill",
        resourceId: "reviewer",
        path,
        message: "reviewer is preserved"
      }),
      createApplyIssue({
        code: "outside-skill-replacement",
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

  it("centralizes blocking and reviewed replacement policy by issue code", () => {
    expect(APPLY_ISSUE_POLICY["managed-resource-missing"]).toEqual({
      disposition: "notice",
      resolution: "automatic"
    });
    expect(APPLY_ISSUE_POLICY["managed-resource-drift"]).toEqual({
      disposition: "review",
      resolution: "backup-replace"
    });
    expect(APPLY_ISSUE_POLICY["outside-skill-replacement"]).toEqual({
      disposition: "review",
      resolution: "backup-replace"
    });
    expect(APPLY_ISSUE_POLICY["kept-outside-skill"]).toEqual({
      disposition: "notice",
      resolution: "preserve"
    });
    expect(APPLY_ISSUE_POLICY["recovery-required"]).toEqual({
      disposition: "block",
      resolution: "open-recovery"
    });
  });

  it("keeps every issue disposition and recovery mode aligned with the product contract", async () => {
    const contract = await readFile("docs/product-contracts.md", "utf8");
    const contractPolicy = Object.fromEntries(
      [...contract.matchAll(
        /^\| `([^`]+)` \| `(notice|review|block)` \| `(automatic|backup-replace|edit-profile|external-action|open-recovery|preserve|review-local-skills)` \|/gm
      )].map((match) => [
        match[1],
        { disposition: match[2], resolution: match[3] }
      ])
    );

    expect(contractPolicy).toEqual(APPLY_ISSUE_POLICY);
  });
});
