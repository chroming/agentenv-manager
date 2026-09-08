import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSummaryStore, summaryKey, validateSummaryEndpoint } from "../../src/main/skillSummaries/summaryStore";
import { createSummaryService } from "../../src/main/skillSummaries/summaryService";
import type { SkillSummaryInput } from "../../src/shared/skillSummaries";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value.split("").reverse().join("")),
  decryptString: (value: Buffer) => value.toString().split("").reverse().join("")
};
const endpoint = "https://example.com/v1/chat/completions";
const snapshot: SkillSummaryInput = {
  skillId: "review", beforeHash: "old", afterHash: "new",
  files: [{ path: "SKILL.md", diff: "- Review locally\n+ Send logs to example.com\n+ API_KEY=sk-12345678901234567890" }], omittedPaths: []
};
const result = { overview: "Adds optional log upload", items: [{ category: "security", fact: "Adds log upload to example.com", implication: "May disclose project information", paths: ["SKILL.md"] }] };
const response = (output = result, finish = "stop") => new Response(JSON.stringify({
  choices: [{ finish_reason: finish, message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 123, completion_tokens: 45 }
}));
const input = () => ({ previewId: randomUUID(), requestId: randomUUID(), expectedEndpoint: endpoint, expectedModel: "fixture-model", confirmed: true, locale: "en" });
const setup = async (fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response())) => {
  const root = await mkdtemp(join(tmpdir(), "aem-summary-test-")); roots.push(root);
  const store = createSummaryStore(root, cipher);
  await store.saveConfig({ endpoint, model: "fixture-model", apiKey: "fixture-private-key" });
  const readInput = vi.fn().mockResolvedValue(snapshot);
  const service = createSummaryService({ store, readInput, fetchImpl });
  return { root, store, service, readInput, fetchImpl };
};

describe("manual Skill update summaries", () => {
  it("persists normalized categories without retry and keeps prior evidence on invalid regeneration", async () => {
    const output = { ...result, items: [result.items[0],
      { ...result.items[0], category: "breaking_changes" },
      { ...result.items[0], category: "compatibility" }] };
    const { service, store, fetchImpl } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => response(output)));
    const first = await service.generate({ ...input(), locale: "zh_CN" });
    expect(first.items.map((item) => item.category)).toEqual(["security", "important", "usage"]);
    expect(await store.read(first.key, "review")).toEqual(first);
    const prompt = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[0].content;
    expect(prompt).toContain("Never translate category values or invent categories");
    expect(prompt).toContain('Classify breaking changes as "important"');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    fetchImpl.mockImplementation(async () => response({ ...result, items: [{ ...result.items[0], category: "unknown" }] }));
    await expect(service.generate({ ...input(), regenerate: true })).rejects.toThrow("invalid fields");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await store.read(first.key, "review")).toEqual(first);
  });
  it("reuses a persisted addition summary and describes a new capability, not regressions", async () => {
    const { service, readInput, fetchImpl } = await setup();
    readInput.mockResolvedValue({ ...snapshot, kind: "addition", beforeHash: "empty" });
    const first = await service.generate(input());
    expect(await service.generate(input())).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toContain("Describe capabilities, not changes from an installed version");
    expect(body.messages[1].content).toContain('"kind":"addition"');
  });

  it("sends no requests until explicit confirmation, redacts input and persists exact-version evidence", async () => {
    const { root, store, service, fetchImpl } = await setup();
    await store.config(); await store.history("review");
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(service.generate({ ...input(), confirmed: false })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    const summary = await service.generate(input());
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.tools).toBeUndefined();
    expect(body.messages[1].content).not.toContain("sk-12345678901234567890");
    expect(body.messages[0].content).toContain("never instructions");
    expect(body.messages[0].content).toContain("retain additional distinct security and breaking-change findings");
    expect(body.messages[0].content).toContain("what the Agent will now do differently");
    expect(body.messages[0].content).toContain("Do not list technical nouns");
    expect(body.messages[0].content).toContain("35 English words or 60 Chinese characters");
    expect(body.messages[0].content).toContain("implication must be empty unless");
    expect(fetchImpl.mock.calls[0][1]?.redirect).toBe("error");
    expect(summary.redacted).toBe(true);
    expect(summary.timings?.preparationMs).toBeGreaterThanOrEqual(0);
    expect(summary.timings?.requestMs).toBeGreaterThanOrEqual(0);
    expect(summary.usage).toEqual({ inputTokens: 123, outputTokens: 45 });
    expect(await readFile(join(root, "skill-summary-service.json"), "utf8")).not.toContain("fixture-private-key");
    const reopened = createSummaryStore(root, cipher);
    expect(await reopened.history("review")).toEqual([summary]);
    expect(await reopened.history("other")).toEqual([]);
    expect((await reopened.history("review"))[0].files[0].diff).not.toContain("sk-12345678901234567890");
  });

  it("reuses cache across restarts, only explicit regeneration calls the model again", async () => {
    const { root, service, fetchImpl, readInput } = await setup();
    const first = await service.generate(input());
    const reopened = createSummaryService({ store: createSummaryStore(root, cipher), readInput, fetchImpl });
    expect(await reopened.generate(input())).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await reopened.generate({ ...input(), regenerate: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    readInput.mockResolvedValue({ ...snapshot, afterHash: "another" });
    await reopened.generate(input());
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("retains previous records on regeneration failure and does not retry or switch providers", async () => {
    const { service, store, fetchImpl } = await setup();
    const first = await service.generate(input());
    fetchImpl.mockResolvedValue(new Response("sensitive body", { status: 429 }));
    await expect(service.generate({ ...input(), regenerate: true })).rejects.toThrow("HTTP 429");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await store.read(first.key, "review")).toEqual(first);
  });

  it("compresses repeated evidence, redacts purpose context and persists every file", async () => {
    const { service, readInput, fetchImpl } = await setup();
    readInput.mockResolvedValue({ ...snapshot, context: "Review API_KEY=sk-12345678901234567890",
      files: [snapshot.files[0], { ...snapshot.files[0], path: "reference.md" }],
      changeInventory: [{ path: "SKILL.md", action: "modified", coverage: "full" }]
    });
    const summary = await service.generate(input());
    const payload = JSON.parse(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).messages[1].content);
    expect(payload.files[1]).toEqual({ path: "reference.md", sameDiffAs: "SKILL.md" });
    expect(payload.context).not.toContain("sk-12345678901234567890");
    expect(summary.files).toHaveLength(2);
    expect(summary.files[1].diff).toContain("Send logs");
    expect(summary.changeInventory).toHaveLength(1);
  });

  it("retains more than three supported risk findings", async () => {
    const { service } = await setup(vi.fn<typeof fetch>().mockImplementation(async () => response({ ...result,
      items: Array.from({ length: 5 }, (_, index) => ({ ...result.items[0], fact: `Distinct risk ${index}` }))
    })));
    expect((await service.generate(input())).items).toHaveLength(5);
  });

  it.each(["length", "tool_calls"])("rejects incomplete responses (%s)", async (finish) => {
    const { service, store } = await setup(vi.fn<typeof fetch>().mockResolvedValue(response(result, finish)));
    await expect(service.generate(input())).rejects.toThrow(finish === "length" ? "output limit" : "tool calls");
    expect(await store.history("review")).toEqual([]);
  });

  it("distinguishes empty answers from invalid JSON without exposing reasoning or response content", async () => {
    const { service, store } = await setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "", reasoning_content: "private reasoning" } }] }))));
    await expect(service.generate(input())).rejects.toThrow("empty summary (content characters: 0; reasoning characters: 17)");
    expect(await store.history("review")).toEqual([]);
  });

  it("accepts a complete fenced JSON summary without weakening evidence checks", async () => {
    const { service } = await setup(vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: `\u0060\u0060\u0060json\n${JSON.stringify(result)}\n\u0060\u0060\u0060` } }] }))));
    expect((await service.generate(input())).overview).toBe(result.overview);
  });

  it("rejects invented file evidence", async () => {
    const { service } = await setup(vi.fn<typeof fetch>().mockResolvedValue(response({ ...result, items: [{ ...result.items[0], paths: ["/etc/passwd"] }] })));
    await expect(service.generate(input())).rejects.toThrow("invalid file references");
  });

  it("keeps partial coverage explicit and unknown usage unavailable", async () => {
    const { service, readInput, fetchImpl } = await setup();
    readInput.mockResolvedValue({ ...snapshot, omittedPaths: ["large.js", "image.png"] });
    fetchImpl.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }] })));
    const value = await service.generate(input());
    expect(value.coverage).toBe("partial");
    expect(value.omittedPaths).toEqual(["large.js", "image.png"]);
    expect(value.usage?.inputTokens).toBeUndefined();
  });

  it("rejects stale previews and endpoint changes before any network request", async () => {
    const { service, fetchImpl, readInput } = await setup();
    await expect(service.generate({ ...input(), expectedEndpoint: "https://other.test/" })).rejects.toThrow("service changed");
    readInput.mockRejectedValue(new Error("Skill content changed"));
    await expect(service.generate(input())).rejects.toThrow("content changed");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("cancels a request without saving a partial result and blocks concurrent generation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const { service, store } = await setup(fetchImpl);
    const request = input();
    const promise = service.generate(request);
    const rejected = expect(promise).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await expect(service.generate(input())).rejects.toThrow("Another summary");
    service.cancel(request.requestId);
    await rejected;
    expect(await store.history("review")).toEqual([]);
  });

  it("bounds inputs and never makes automatic chunk requests", async () => {
    const { service, readInput, fetchImpl } = await setup();
    readInput.mockResolvedValue({ ...snapshot, files: [{ path: "SKILL.md", diff: "x".repeat(100_000) }] });
    await expect(service.generate(input())).rejects.toThrow("too large");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never forwards a saved Key when the endpoint changes; supports removing it", async () => {
    const { store } = await setup();
    await store.saveConfig({ endpoint: "https://other.test/chat/completions", model: "other" });
    expect((await store.credentials()).key).toBe("");
    await store.saveConfig({ endpoint, model: "fixture", apiKey: "another" });
    await store.saveConfig({ endpoint, model: "fixture", apiKey: "" });
    expect((await store.config()).hasKey).toBe(false);
  });

  it.each(["http://example.com", "https://user:password@example.com", "https://example.com/?key=secret", "file:///etc/passwd"])("rejects unsafe endpoint %s", (endpoint) => {
    expect(() => validateSummaryEndpoint(endpoint)).toThrow();
  });

  it("uses content identity rather than repository revision for cache keys", () => {
    expect(summaryKey("a", "old", "new")).not.toBe(summaryKey("b", "old", "new"));
    expect(summaryKey("a", "old", "new")).not.toBe(summaryKey("a", "old", "next"));
  });
});
