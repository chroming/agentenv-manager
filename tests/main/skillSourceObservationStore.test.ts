import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSkillSourceObservationStore } from "../../src/main/skillSourceObservationStore";
import type { SkillSourceObservation } from "../../src/shared/skillSourceGrouping";

let root = "";

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

const observation: SkillSourceObservation = {
  formatVersion: 1,
  canonicalLink: "https://github.com/acme/skills/tree/main/engineering",
  repository: "https://github.com/acme/skills.git",
  ref: "main",
  directory: "engineering",
  checkedAt: "2026-07-21T00:00:00.000Z",
  accessTransport: "https",
  complete: true,
  candidates: [{
    sourceSubpath: "review",
    directory: "engineering/review",
    name: "review",
    description: "Review code",
    contentRevision: "revision-1",
    compatibleRevisions: ["legacy-revision-1"],
    validity: "valid"
  }]
};

describe("skill source observation store", () => {
  it("round-trips a complete observation using the canonical link key", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-observation-"));
    const store = createSkillSourceObservationStore(root);

    await store.write(observation);
    await expect(store.read(observation.canonicalLink)).resolves.toEqual(observation);
  });

  it("isolates corrupt cache data instead of failing the Library", async () => {
    root = await mkdtemp(join(tmpdir(), "agentenv-source-observation-"));
    const store = createSkillSourceObservationStore(root);
    await store.write(observation);
    const [fileName] = await readdir(root);
    await writeFile(join(root, fileName), "{broken");

    await expect(store.read(observation.canonicalLink)).resolves.toBeUndefined();
    await expect(readFile(join(root, fileName), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
