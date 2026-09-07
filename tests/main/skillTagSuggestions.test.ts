import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSkillTagSuggestionService } from "../../src/main/ai/skillTagSuggestions";
import { createAIJsonClient } from "../../src/main/ai/aiJsonClient";
import { createSummaryStore } from "../../src/main/skillSummaries/summaryStore";
import type { SkillLibraryEntry, SkillTagsInput } from "../../src/shared/types";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const endpoint = "https://example.test/v1/chat/completions";
const response = (tags = [{ tag: "Testing", reason: "Tests code." }], finish = "stop") => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify({ tags }) } }] }));
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), "aem-ai-tags-")); roots.push(root);
  const path = join(root, "library", "review"); await mkdir(path, { recursive: true });
  const text = "---\nname: review\ndescription: Test code\n---\nTest code. API_KEY=sk-12345678901234567890\n";
  await writeFile(join(path, "SKILL.md"), text);
  const skills: SkillLibraryEntry[] = [{ id: "review", name: "review", description: "Test code", path, sourceType: "local", contentHash: "fixture", updatePolicy: "untracked", updatedAt: "2026-09-05", tags: ["Development"] }];
  const library = { listSkills: vi.fn(async () => skills), setTags: vi.fn(async (input: SkillTagsInput) => {
    skills[0].tags = input.tags; skills[0].aiTags = input.aiTags; return skills[0];
  }) };
  const configStore = createSummaryStore(root, { isEncryptionAvailable: () => true, encryptString: (text) => Buffer.from(text), decryptString: (value) => value.toString() });
  await configStore.saveConfig({ endpoint, model: "mock-model" });
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response());
  const request = createAIJsonClient(fetchImpl);
  const service = createSkillTagSuggestionService({ root, library, configStore, request });
  const input = async () => ({ skillId: "review", expectedKey: (await service.prepare("review", "en")).key, requestId: randomUUID(), expectedEndpoint: endpoint, expectedModel: "mock-model", confirmed: true, locale: "en" });
  return { root, path, text, skills, library, configStore, fetchImpl, service, input, request };
};

describe("manual AI Skill tags", () => {
  it("reads cache without requests and sends only name, description and vocabulary", async () => {
    const f = await setup();
    await f.service.prepare("review", "en");
    const input = await f.input();
    await expect(f.service.generate({ ...input, confirmed: false })).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    const record = await f.service.generate(input);
    expect(f.library.setTags).not.toHaveBeenCalled();
    const payload = JSON.parse(String(f.fetchImpl.mock.calls[0][1]?.body));
    expect(payload.tools).toBeUndefined();
    expect(payload.messages[0].content).toContain("never instructions");
    expect(payload.messages[1].content).not.toContain("sk-12345678901234567890");
    expect(payload.messages[1].content).not.toContain(f.root);
    expect(JSON.parse(payload.messages[1].content).vocabulary).toEqual(["Development"]);
    expect(JSON.parse(payload.messages[1].content).skill).toEqual({ name: "review", description: "Test code" });
    expect(JSON.parse(payload.messages[1].content).fixedVocabulary).toEqual(["Development"]);
    expect(record.tags[0].tag).toBe("Testing");
    expect(await readFile(join(f.path, "SKILL.md"), "utf8")).toBe(f.text);
  });
  it("persists across service restarts, requires explicit regeneration, and keeps previous results on failure", async () => {
    const f = await setup(); const input = await f.input();
    const first = await f.service.generate(input);
    const reopened = createSkillTagSuggestionService({ ...f, configStore: f.configStore });
    expect((await reopened.prepare("review", "en")).cached).toEqual(first);
    expect(await f.service.generate(input)).toEqual(first);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    f.fetchImpl.mockImplementation(async () => new Response("private error", { status: 429 }));
    await expect(f.service.generate({ ...input, regenerate: true })).rejects.toThrow("HTTP 429");
    expect((await f.service.prepare("review", "en")).cached).toEqual(first);
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("invalidates cache when contents, vocabulary or language change", async () => {
    const f = await setup(); const old = await f.service.prepare("review", "en");
    const zh = await f.service.prepare("review", "zh_CN"); expect(zh.key).not.toBe(old.key);
    f.skills[0].tags!.push("Testing");
    const vocab = await f.service.prepare("review", "en"); expect(vocab.key).not.toBe(old.key);
    await writeFile(join(f.path, "SKILL.md"), `${f.text}Updated`);
    expect((await f.service.prepare("review", "en")).key).not.toBe(vocab.key);
    await expect(f.service.generate({ ...await f.input(), expectedKey: old.key })).rejects.toThrow("changed");
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("merges concurrent human tags and normalizes duplicates without writing Skill contents", async () => {
    const f = await setup(); const record = await f.service.generate(await f.input());
    f.skills[0].tags!.push("Manual");
    await f.service.apply({ id: "review", suggestionKey: record.key, tags: ["Testing", "testing", " Manual "] });
    expect(f.skills[0].tags).toEqual(["Development", "Manual", "Testing"]);
    expect(f.skills[0].aiTags).toEqual(["Testing"]);
    expect(await readFile(join(f.path, "SKILL.md"), "utf8")).toBe(f.text);
  });
  it("does not silently truncate tags at the limit", async () => {
    const f = await setup(); const record = await f.service.generate(await f.input());
    f.skills[0].tags = Array.from({ length: 12 }, (_, i) => `tag-${i}`);
    await expect(f.service.apply({ id: "review", suggestionKey: record.key, tags: ["Testing"] })).rejects.toThrow("12");
    expect(f.library.setTags).not.toHaveBeenCalled();
  });
  it("replaces old AI tags but keeps manual tags and manually typed additions", async () => {
    const f = await setup();
    f.skills[0].tags = ["Development", "Old"];
    f.skills[0].aiTags = ["Old"];
    const record = await f.service.generate(await f.input());
    await f.service.apply({ id: "review", suggestionKey: record.key, tags: ["Testing", "Typed"] });
    expect(f.skills[0].tags).toEqual(["Development", "Testing", "Typed"]);
    expect(f.skills[0].aiTags).toEqual(["Testing"]);
    await f.service.apply({ id: "review", suggestionKey: record.key, tags: [] });
    expect(f.skills[0].tags).toEqual(["Development", "Typed"]);
    expect(f.skills[0].aiTags).toEqual([]);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("refuses stale content and deleted Skills on save", async () => {
    const f = await setup(); const record = await f.service.generate(await f.input());
    await writeFile(join(f.path, "SKILL.md"), "Updated");
    await expect(f.service.apply({ id: "review", suggestionKey: record.key, tags: ["Testing"] })).rejects.toThrow("changed");
    f.skills.splice(0);
    await expect(f.service.apply({ id: "review", suggestionKey: record.key, tags: ["Testing"] })).rejects.toThrow("no longer");
    expect(f.library.setTags).not.toHaveBeenCalled();
  });
  it("reuses vocabulary spelling without inventing translated duplicates", async () => {
    const f = await setup(); f.skills[0].tags!.push("Testing");
    f.fetchImpl.mockImplementation(async () => response([{ tag: " testing ", reason: "Code tests" }, { tag: "TESTING", reason: "Same" }]));
    const record = await f.service.generate(await f.input());
    expect(record.tags).toEqual([{ tag: "Testing", reason: "Code tests" }]);
  });
  it("identifies partial inputs without automatic chunk requests", async () => {
    const f = await setup(); f.skills[0].description = "Review code. ".repeat(3000);
    expect((await f.service.prepare("review", "en")).partial).toBe(true);
    expect((await f.service.generate(await f.input())).partial).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("uses global fixed tags as style references and invalidates provenance changes", async () => {
    const f = await setup();
    f.skills.push({ ...f.skills[0], id: "other", tags: ["Code Review", "Suggested"], aiTags: ["Suggested"] });
    const before = await f.service.prepare("review", "en");
    await f.service.generate(await f.input());
    const body = JSON.parse(String(f.fetchImpl.mock.calls[0][1]?.body));
    expect(JSON.parse(body.messages[1].content).fixedVocabulary).toEqual(["Code Review", "Development"]);
    expect(body.messages[0].content).toContain("Never force an unrelated existing tag");
    f.skills[1].aiTags = [];
    expect((await f.service.prepare("review", "en")).key).not.toBe(before.key);
  });
  it.each(["length", "tool_calls"])("rejects incomplete output %s", async (finish) => {
    const f = await setup(); f.fetchImpl.mockImplementation(async () => response(undefined, finish));
    await expect(f.service.generate(await f.input())).rejects.toThrow("invalid tag");
    expect((await f.service.prepare("review", "en")).cached).toBeUndefined();
  });
  it("rejects invalid output and oversized/binary inputs", async () => {
    const f = await setup(); f.fetchImpl.mockImplementation(async () => response([{ tag: "x".repeat(33), reason: "Too long" }]));
    await expect(f.service.generate(await f.input())).rejects.toThrow("invalid tag");
    await writeFile(join(f.path, "SKILL.md"), Buffer.from([0, 1, 2]));
    await expect(f.service.prepare("review", "en")).rejects.toThrow("readable text");
    await writeFile(join(f.path, "SKILL.md"), "x".repeat(1_000_001));
    await expect(f.service.prepare("review", "en")).rejects.toThrow("too large");
  });
  it("rejects SKILL.md links to outside data without reading them", async () => {
    const f = await setup(); const outside = join(f.root, "private.md"); await writeFile(outside, "private");
    await rm(join(f.path, "SKILL.md")); await symlink(outside, join(f.path, "SKILL.md"));
    const result = await f.service.prepareBatch(["review", "missing"], "en");
    expect(result.items).toEqual([]); expect(result.errors).toHaveLength(2);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("cancels and preserves the cache; rejects changed service configuration", async () => {
    const f = await setup(); const input = await f.input();
    await expect(f.service.generate({ ...input, expectedModel: "other" })).rejects.toThrow("service changed");
    f.fetchImpl.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const promise = f.service.generate(input); const rejected = expect(promise).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalled());
    await expect(f.service.generate(input)).rejects.toThrow("Another tag");
    f.service.cancel(input.requestId); await rejected;
    expect((await f.service.prepare("review", "en")).cached).toBeUndefined();
  });
  it("batch preparation lists the library once and keeps individual failures isolated", async () => {
    const f = await setup();
    const result = await f.service.prepareBatch(["review", "missing"], "en");
    expect(f.library.listSkills).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1); expect(result.errors).toHaveLength(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
