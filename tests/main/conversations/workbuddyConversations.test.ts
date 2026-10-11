import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWorkBuddyTargetAdapter } from "../../../src/main/targets/integrations/workbuddy";
import { createWorkBuddyConversationCapability } from "../../../src/main/targets/conversations/workbuddyConversations";
import { parseHistoryText } from "../../../src/main/targets/conversations/historySourceAdapter";

let root = "";
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
const setup = async () => {
  root = await mkdtemp(join(tmpdir(), "aem-workbuddy-history-"));
  const targetPaths = createWorkBuddyTargetAdapter().createTargetPaths({ homeDir: root });
  const context = { homeDir: root, targetPaths };
  const folder = join(targetPaths.configDir, "projects", "fixture");
  await mkdir(folder, { recursive: true });
  return { context, folder, capability: createWorkBuddyConversationCapability() };
};

it("reads text exports with native title priority, metadata cwd and message timestamps", async () => {
  const { context, folder, capability } = await setup();
  const path = join(folder, "session.jsonl");
  const text = [
    { type: "message", role: "user", content: [{ type: "input_text", text: "Review my changes" }], timestamp: 1780000000000 },
    { type: "custom-title", customTitle: "Chosen title" },
    { type: "ai-title", aiTitle: "Generated title" },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Review complete" }], timestamp: 1780000060000 },
    { type: "function_call", name: "read", arguments: "fixture" }
  ].map((value) => JSON.stringify(value)).join("\n");
  await writeFile(path, text);
  await writeFile(join(folder, "session.meta.json"), JSON.stringify({ cwd: "/projects/example" }));
  const discovery = await capability.discover(context);
  expect(discovery.complete).toBe(true);
  expect(discovery.candidates).toHaveLength(1);
  const detail = await capability.read(context, discovery.candidates[0]);
  expect(detail).toMatchObject({ agentId: "workbuddy", title: "Chosen title", workspacePath: "/projects/example", messageCount: 2, detailState: "full" });
  expect(detail.messages[1].createdAt).toBe(new Date(1780000060000).toISOString());
  expect(parseHistoryText("workbuddy", "WorkBuddy", discovery.candidates[0], text).toolText).toContain("fixture");
  expect(await readFile(path, "utf8")).toBe(text);
  expect(capability.openOriginal).toBeUndefined();
  expect(capability.move).toBeUndefined();
});

it("does not report database-only history as a successful empty inventory", async () => {
  const { context, folder, capability } = await setup();
  await rm(join(folder, ".."), { recursive: true });
  await writeFile(join(context.targetPaths.configDir, "workbuddy.db"), "unverified database fixture");
  const result = await capability.discover(context);
  expect(result.complete).toBe(false);
  expect(result.failures?.join(" ")).toContain("database histories are not yet supported");
  expect(result.candidates).toHaveLength(0);
});

it("keeps nested histories, marks partial content and refuses external metadata links", async () => {
  const { context, folder, capability } = await setup();
  const subagents = join(folder, "parent", "subagents");
  await mkdir(subagents, { recursive: true });
  await writeFile(join(subagents, "child.jsonl"), 'broken\n{"type":"message","role":"user","content":"Readable"}\n');
  await writeFile(join(root, "outside.json"), '{"cwd":"/must-not-read"}');
  await symlink(join(root, "outside.json"), join(subagents, "child.meta.json"));
  const result = await capability.discover(context);
  expect(result.complete).toBe(false);
  expect(result.candidates).toHaveLength(1);
  expect(result.failures?.join(" ")).toContain("leaves the approved");
  const detail = await capability.read(context, result.candidates[0]);
  expect(detail.detailState).toBe("summary-only");
  expect(detail.workspacePath).toBeUndefined();
  expect(detail.messages[0].text).toBe("Readable");
});
