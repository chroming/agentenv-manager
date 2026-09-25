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
