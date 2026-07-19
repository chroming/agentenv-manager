import { describe, expect, it } from "vitest";
import { createClaudeCodeTargetAdapter } from "../../src/main/targets/claudeCodeTarget";
import { createCodexTargetAdapter } from "../../src/main/targets/codexTarget";
import { createOpenCodeTargetAdapter } from "../../src/main/targets/opencodeTarget";
import { createAntigravityTargetAdapter } from "../../src/main/targets/integrations/antigravity";
import { createTraeCliTargetAdapter } from "../../src/main/targets/integrations/trae-cli";

describe("MCP management boundary", () => {
  it("advertises activation control only where an adapter can patch enabled state safely", () => {
    expect(createOpenCodeTargetAdapter().descriptor.capabilities.mcpActivation).toBe(true);
    expect(createCodexTargetAdapter().descriptor.capabilities.mcpActivation).toBe(true);
    expect(createClaudeCodeTargetAdapter().descriptor.capabilities.mcpActivation).toBe(false);
    expect(createAntigravityTargetAdapter().descriptor.capabilities.mcpActivation).toBe(false);
    expect(createTraeCliTargetAdapter().descriptor.capabilities.mcpActivation).toBe(true);
  });
});
