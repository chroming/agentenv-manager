import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { SkillInventoryEntry } from "../../src/shared/types";
import { hashSkillContent } from "../../src/main/skillContentHash";
import { applyLibraryUpdatePropagation, prepareLibraryUpdatePropagation } from "../../src/main/skillLibraryUpdatePropagation";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

const fixture = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-propagation-"));
  const installed = join(root, "installed");
  const source = join(root, "source");
  const states = join(root, "states");
  for (const path of [installed, source, states]) await mkdir(path);
  await writeFile(join(installed, "SKILL.md"), "# Old");
  await writeFile(join(source, "SKILL.md"), "# New");
  const currentContentHash = await hashSkillContent(installed);
  const nextContentHash = await hashSkillContent(source);
  const entry: SkillInventoryEntry = {
    id: "review", name: "review", description: "", skillKey: "review", libraryId: "review",
    path: installed, contentHash: currentContentHash, status: "managed", installMethod: "copied",
    contentMatchesLibrary: true, foundIn: ["codex", "claude-code", "opencode"]
  };
  for (const id of entry.foundIn) await writeFile(join(states, id + ".json"), JSON.stringify({
    formatVersion: 3, managedMcpNames: [], skillReceipts: [], sharedSkillPreparations: [],
    appliedLibraryVersions: { skills: { review: currentContentHash } },
    managedResources: id === "opencode" ? [] : [{
      kind: "skill", id: "review", path: installed, contentHash: currentContentHash
    }]
  }));
  const propagation = await prepareLibraryUpdatePropagation({
    inventory: [entry], libraryId: "review", currentContentHash, nextContentHash,
    targetStatesDir: states, syncCopiedInstalls: true
  });
  return { installed, source, states, currentContentHash, nextContentHash, propagation };
};

it("updates every owning Agent receipt without changing an observing Agent's state", async () => {
  const f = await fixture();
  expect(f.propagation.stateUpdates).toHaveLength(2);
  const observer = await readFile(join(f.states, "opencode.json"), "utf8");
  await applyLibraryUpdatePropagation({ sourceDir: f.source, nextContentHash: f.nextContentHash, propagation: f.propagation });
  for (const id of ["codex", "claude-code"]) {
    const state = JSON.parse(await readFile(join(f.states, id + ".json"), "utf8"));
    expect(state.managedResources[0].contentHash).toBe(f.nextContentHash);
    expect(state.appliedLibraryVersions.skills.review).toBe(f.nextContentHash);
  }
  expect(await readFile(join(f.states, "opencode.json"), "utf8")).toBe(observer);
});

it("preserves an Agent copy changed after preparation", async () => {
  const f = await fixture();
  await writeFile(join(f.installed, "SKILL.md"), "# External change");
  await expect(applyLibraryUpdatePropagation({
    sourceDir: f.source, nextContentHash: f.nextContentHash, propagation: f.propagation
  })).rejects.toThrow();
  expect(await readFile(join(f.installed, "SKILL.md"), "utf8")).toBe("# External change");
});

it("does not overwrite an Agent receipt changed after preparation", async () => {
  const f = await fixture();
  const statePath = join(f.states, "codex.json");
  const changed = (await readFile(statePath, "utf8")) + "\n";
  await writeFile(statePath, changed);
  await expect(applyLibraryUpdatePropagation({
    sourceDir: f.source, nextContentHash: f.nextContentHash, propagation: f.propagation
  })).rejects.toThrow();
  expect(await readFile(statePath, "utf8")).toBe(changed);
});
