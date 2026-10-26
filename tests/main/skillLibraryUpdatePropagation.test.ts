import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { SkillInventoryEntry } from "../../src/shared/types";
import { hashSkillContent } from "../../src/main/skillContentHash";
import { hashInvokedSkill } from "../../src/main/skillInvocation";
import { deploySkillDirectory } from "../../src/main/skillDeployment";
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
  return { installed, source, states, entry, currentContentHash, nextContentHash, propagation };
};

it("updates an unchanged older managed copy using its deployment receipt rather than the current Library version", async () => {
  const f = await fixture();
  const currentLibraryHash = f.nextContentHash;
  await writeFile(join(f.source, "SKILL.md"), "# Third version");
  const nextContentHash = await hashSkillContent(f.source);
  const propagation = await prepareLibraryUpdatePropagation({
    inventory: [{ ...f.entry, contentMatchesLibrary: false }], libraryId: "review",
    currentContentHash: currentLibraryHash, nextContentHash, targetStatesDir: f.states, syncCopiedInstalls: true
  });
  expect(propagation.copiedInstalls).toHaveLength(1);
  await applyLibraryUpdatePropagation({ sourceDir: f.source, nextContentHash, propagation });
  expect(await readFile(join(f.installed, "SKILL.md"), "utf8")).toBe("# Third version");
});

it("preserves an externally changed copy without blocking the Library update", async () => {
  const f = await fixture();
  await writeFile(join(f.installed, "SKILL.md"), "# Device edit");
  const propagation = await prepareLibraryUpdatePropagation({
    inventory: [{ ...f.entry, contentHash: await hashSkillContent(f.installed), contentMatchesLibrary: false }],
    libraryId: "review", currentContentHash: f.currentContentHash, nextContentHash: f.nextContentHash,
    targetStatesDir: f.states, syncCopiedInstalls: true
  });
  expect(propagation.copiedInstalls).toHaveLength(0);
  expect(propagation).toMatchObject({ skippedCopiedInstalls: [{ path: f.installed }] });
  expect(propagation.stateUpdates).toHaveLength(0);
  expect(await readFile(join(f.installed, "SKILL.md"), "utf8")).toBe("# Device edit");
});

it("advances a healthy neighbor while retaining the changed copy's receipt", async () => {
  const f = await fixture();
  const changed = join(root, "changed");
  await mkdir(changed);
  await writeFile(join(changed, "SKILL.md"), "# Device edit");
  const statePath = join(f.states, "claude-code.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.managedResources[0].path = changed;
  await writeFile(statePath, JSON.stringify(state));
  const savedState = await readFile(statePath, "utf8");
  const propagation = await prepareLibraryUpdatePropagation({
    inventory: [
      { ...f.entry, foundIn: ["codex"] },
      { ...f.entry, foundIn: ["claude-code"], path: changed, contentMatchesLibrary: false }
    ], libraryId: "review", currentContentHash: f.currentContentHash, nextContentHash: f.nextContentHash,
    targetStatesDir: f.states, syncCopiedInstalls: true
  });
  await applyLibraryUpdatePropagation({ sourceDir: f.source, nextContentHash: f.nextContentHash, propagation });
  expect(await readFile(join(f.installed, "SKILL.md"), "utf8")).toBe("# New");
  expect(await readFile(join(changed, "SKILL.md"), "utf8")).toBe("# Device edit");
  expect(await readFile(statePath, "utf8")).toBe(savedState);
  expect(propagation.skippedCopiedInstalls).toEqual([{ path: changed, targetIds: ["claude-code"] }]);
});

it("does not overwrite an unverifiable old managed copy without a deployment receipt", async () => {
  const f = await fixture();
  for (const id of ["codex", "claude-code"]) await rm(join(f.states, id + ".json"));
  const propagation = await prepareLibraryUpdatePropagation({
    inventory: [{ ...f.entry, contentMatchesLibrary: false }], libraryId: "review",
    currentContentHash: f.nextContentHash, nextContentHash: "next", targetStatesDir: f.states, syncCopiedInstalls: true
  });
  expect(propagation.copiedInstalls).toHaveLength(0);
  expect(propagation.skippedCopiedInstalls).toHaveLength(1);
  expect(propagation.stateUpdates).toHaveLength(0);
});

it("does not mistake an edited manual-only copy's observed hash for a trusted deployment baseline", async () => {
  const f = await fixture();
  await writeFile(join(f.installed, "SKILL.md"), "# Edited manual Skill");
  const propagation = await prepareLibraryUpdatePropagation({
    inventory: [{ ...f.entry, contentHash: await hashSkillContent(f.installed), invocationMode: "manual",
      invocationTargetId: "claude-code", sourceContentHash: f.currentContentHash, contentMatchesLibrary: false }],
    libraryId: "review", currentContentHash: f.currentContentHash, nextContentHash: f.nextContentHash,
    targetStatesDir: f.states, syncCopiedInstalls: true
  });
  expect(propagation.copiedInstalls).toHaveLength(0);
  expect(propagation.skippedCopiedInstalls).toHaveLength(1);
});

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

it("retains a manual invocation override and separate source/deployment hashes during update", async () => {
  const f = await fixture();
  const original = "---\nname: review\ndescription: Review\n---\nOld body\n";
  await writeFile(join(f.source, "SKILL.md"), original);
  const currentContentHash = await hashSkillContent(f.source);
  await deploySkillDirectory({ sourceDir: f.source, targetDir: f.installed, syncMethod: "copy", targetId: "claude-code", invocationMode: "manual" });
  const installedHash = await hashSkillContent(f.installed);
  const statePath = join(f.states, "claude-code.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.managedResources[0] = { ...state.managedResources[0], contentHash: installedHash, sourceContentHash: currentContentHash, invocationMode: "manual" };
  await writeFile(statePath, JSON.stringify(state));
  await writeFile(join(f.source, "SKILL.md"), original.replace("Old body", "New body"));
  const nextContentHash = await hashSkillContent(f.source);
  const propagation = await prepareLibraryUpdatePropagation({
    inventory: [{ id: "review", name: "review", description: "", skillKey: "review", libraryId: "review",
      path: f.installed, contentHash: installedHash, sourceContentHash: currentContentHash,
      invocationMode: "manual", invocationTargetId: "claude-code", foundIn: ["claude-code"],
      status: "managed", installMethod: "copied", contentMatchesLibrary: true }],
    libraryId: "review", currentContentHash, nextContentHash, targetStatesDir: f.states, syncCopiedInstalls: true
  });
  await applyLibraryUpdatePropagation({ sourceDir: f.source, nextContentHash, propagation });
  const updated = JSON.parse(await readFile(statePath, "utf8"));
  expect(updated.managedResources[0].contentHash).toBe(await hashInvokedSkill(f.source, "claude-code", "manual"));
  expect(updated.managedResources[0].sourceContentHash).toBe(nextContentHash);
  expect(updated.appliedLibraryVersions.skills.review).toBe(nextContentHash);
  expect(await readFile(join(f.installed, "SKILL.md"), "utf8")).toContain("disable-model-invocation: true");
  expect(await readFile(join(f.source, "SKILL.md"), "utf8")).not.toContain("disable-model-invocation");
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
