import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTargetRegistry } from "../../../src/main/targets/registry";
import { blockingMessages } from "../../helpers/applyIssues";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

describe("Target resource management contract", () => {
  it.each(["codex", "opencode", "claude-code", "antigravity", "trae-cli"])(
    "leaves Instructions and Skills untouched for %s when their Profile modes are off",
    async (targetId) => {
      root = await mkdtemp(join(tmpdir(), `agentenv-${targetId}-resource-policy-`));
      const adapter = createTargetRegistry().get(targetId);
      const targetPaths = adapter.createTargetPaths({ homeDir: root });
      await mkdir(dirname(targetPaths.instructionsPath), { recursive: true });
      await writeFile(targetPaths.instructionsPath, "# Live instructions\n", "utf8");
      const profile = adapter.createDefaultProfile("daily");
      profile.instructions = "# Profile instructions\n";
      profile.resources = {
        ...profile.resources,
        skills: [{ libraryId: "reviewer", targetName: "reviewer", enabled: true }],
        managementByTarget: {
          [targetId]: { instructions: "ignore", skills: "ignore" }
        },
        mcpByTarget: {
          ...profile.resources.mcpByTarget,
          [targetId]: { mode: "ignore", selections: [] }
        }
      };

      const preview = await adapter.createPreview({
        profile,
        targetPaths,
        state: { managedMcpNames: [] }
      });

      expect(blockingMessages(preview.issues)).toEqual([]);
      expect(preview.changes.map((change) => change.path)).not.toContain(
        targetPaths.instructionsPath
      );
      expect(preview.liveFingerprints).not.toHaveProperty(targetPaths.instructionsPath);
      await expect(adapter.validateAssets({ profile, targetPaths })).resolves.toEqual([]);
      await expect(adapter.getAssetBackupPaths({ profile, targetPaths })).resolves.toEqual([]);
    }
  );
});
