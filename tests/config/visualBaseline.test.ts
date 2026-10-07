import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps a reviewed image hash for every critical visual scenario", async () => {
  const root = join(process.cwd(), "tests", "visual");
  const contract = JSON.parse(await readFile(join(root, "critical-captures.json"), "utf8"));
  const review = JSON.parse(await readFile(join(root, "baseline-review.json"), "utf8"));
  const files = contract.captures.map((capture: { file: string }) => capture.file).sort();
  expect(review.files.map((file: { file: string }) => file.file).sort()).toEqual(files);
  expect(review.build.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(review.build.artifactFingerprint).toMatch(/^[a-f0-9]{64}$/);
  for (const entry of review.files) {
    const content = await readFile(join(root, "golden", entry.file));
    expect(createHash("sha256").update(content).digest("hex"), entry.file).toBe(entry.sha256);
    expect(entry.reviewReason.length).toBeGreaterThan(0);
  }
});

it("captures history and invocation scenarios in both visual verification entry points", async () => {
  for (const file of ["verify-product.mjs", "verify-visual.mjs"]) {
    const source = await readFile(join(process.cwd(), "scripts", file), "utf8");
    expect(source, file).toContain("tests/e2e/conversationHistorySearch.e2e.test.ts");
    expect(source, file).toContain("AGENTENV_CAPTURE_HISTORY_DIR");
    expect(source, file).toContain("persists manual Skill invocation");
    expect(source, file).toContain("AGENTENV_STATUS_CAPTURE_DIR");
  }
});
