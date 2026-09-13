import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listFilesRecursively } from "../../../src/main/conversations/adapterUtils";
import { createCodexTargetAdapter } from "../../../src/main/targets/codexTarget";
import { createClaudeCodeTargetAdapter } from "../../../src/main/targets/claudeCodeTarget";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
it("keeps readable siblings, follows internal links once and reports unavailable or outside links", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-history-walk-"));
  const approved = join(root, "approved");
  await mkdir(join(approved, "actual"), { recursive: true });
  await writeFile(join(approved, "actual/session.jsonl"), "{}\n");
  await writeFile(join(root, "private.jsonl"), "private");
  await symlink(join(approved, "actual"), join(approved, "alias"), "dir");
  await symlink(approved, join(approved, "actual/loop"), "dir");
  await symlink(join(root, "private.jsonl"), join(approved, "outside.jsonl"));
  await symlink(join(approved, "missing"), join(approved, "broken.jsonl"));
  const issues: string[] = [];
  const files = await listFilesRecursively(approved, (p) => p.endsWith(".jsonl"), { onIssue: (message) => issues.push(message) });
  expect(files).toHaveLength(1);
  expect(issues.join("\n")).toContain("Add its destination in History sources");
  expect(issues.join("\n")).toContain("broken.jsonl");
});

it.each([createCodexTargetAdapter, createClaudeCodeTargetAdapter])("retains readable Agent histories when a sibling link is broken", async (factory) => {
  root = await mkdtemp(join(tmpdir(), "aem-history-agent-"));
  const adapter = factory();
  const targetPaths = adapter.createTargetPaths({ homeDir: root, environment: {} });
  const folder = join(targetPaths.configDir, adapter.descriptor.id === "codex" ? "archived_sessions" : "projects/project/subagents");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "readable.jsonl"), "{}\n");
  await symlink(join(folder, "missing"), join(folder, "broken.jsonl"));
  const result = await adapter.conversations!.discover({ homeDir: root, targetPaths, environment: {}, platform: process.platform });
  expect(result.candidates).toHaveLength(1);
  expect(result.complete).toBe(false);
  expect(result.failures?.join("\n")).toContain("broken.jsonl");
});

it("treats a readable archive-only Codex home as a complete inventory", async () => {
  root = await mkdtemp(join(tmpdir(),"aem-history-archive-"));
  const adapter = createCodexTargetAdapter();
  const targetPaths = adapter.createTargetPaths({homeDir:root,environment:{}});
  await mkdir(join(targetPaths.configDir,"archived_sessions"),{recursive:true});
  await writeFile(join(targetPaths.configDir,"archived_sessions/old.jsonl"),"{}\n");
  const result = await adapter.conversations!.discover({homeDir:root,targetPaths,environment:{},platform:process.platform});
  expect(result.complete).toBe(true);
  expect(result.candidates).toHaveLength(1);
});
