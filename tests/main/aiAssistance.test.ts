import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAIPreferences } from "../../src/main/ai/aiPreferences";
import { createAnalysisService } from "../../src/main/ai/analysisService";
import { createAnalysisInputs } from "../../src/main/ai/analysisInputs";
import { createSummaryStore } from "../../src/main/skillSummaries/summaryStore";
import { aiFeatures, defaultAIPreferences, type AIAnalysisSubject } from "../../src/shared/aiAssistance";
import type { ProfileDetail } from "../../src/shared/types";
import type { OneShotEvaluationRun } from "../../src/shared/evaluations";
import { planAnalysisBudget, analysisPayload } from "../../src/main/ai/analysisBudget";
import { AI_INPUT_BYTES, createAIJsonClient } from "../../src/main/ai/aiJsonClient";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const root = async () => { const dir = await mkdtemp(join(tmpdir(), "aem-ai-")); roots.push(dir); return dir; };
const subject: AIAnalysisSubject = { kind: "duplicates", documents: [{ id: "a", label: "Library", content: "Review changes" }, { id: "b", label: "Local", content: "Review code" }] };
const fixture = async () => {
  const dir = await root();
  const config = createSummaryStore(dir, { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (v) => v.toString() });
  await config.saveConfig({ endpoint: "http://localhost/api", model: "fixture", apiKey: "" });
  const input = { documents: subject.kind === "duplicates" ? subject.documents : [], warnings: [] as string[] };
  const readInput = vi.fn().mockImplementation(async () => input);
  const request = vi.fn().mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ overview: "Adds code review", findings: [{ category: "observation", detail: "Code review added", suggestion: "Inspect the change", evidence: ["b"] }], limitations: [] }) } }] });
  const service = createAnalysisService({ root: dir, configStore: config, readInput, request });
  const preview = await service.prepare(subject, "en");
  const args = { subject, locale: "en", requestId: randomUUID(), expectedKey: preview.key, confirmed: true as const, expectedEndpoint: "http://localhost/api", expectedModel: "fixture" };
  return { dir, config, input, readInput, request, service, args };
};
describe("AI assistance privacy gates", () => {
  it.each(aiFeatures)("disables %s without disturbing the other preferences or calling the operation", async (feature) => {
    const dir = await root(); const store = createAIPreferences(dir);
    const next = defaultAIPreferences(); next.features[feature] = false;
    await store.save(next); const request = vi.fn();
    await expect(store.run(feature, request)).rejects.toThrow("turned off"); expect(request).not.toHaveBeenCalled();
    await store.save({ ...next, enabled: false }); await store.save({ ...next, enabled: true });
    expect(await createAIPreferences(dir).read()).toEqual(next);
  });
  it("cancels active work and blocks all features when the master switch closes", async () => {
    const store = createAIPreferences(await root());
    let signal: AbortSignal | undefined;
    const task = store.run("comparison", async (value) => { signal = value; return new Promise<boolean>((resolve) => value.addEventListener("abort", () => resolve(value.aborted))); });
    await vi.waitFor(() => expect(signal).toBeDefined());
    await store.save({ ...defaultAIPreferences(), enabled: false });
    expect(await task).toBe(true);
    for (const feature of aiFeatures) await expect(store.run(feature, vi.fn())).rejects.toThrow("turned off");
  });
  it("fails closed on malformed preferences", async () => {
    const dir = await root(); await writeFile(join(dir, "ai-preferences.json"), "broken");
    await expect(createAIPreferences(dir).run("tags", vi.fn())).rejects.toThrow("No AI request");
  });
});
describe("immutable AI analyses", () => {
  it("requests a focused Profile brief and preserves issue titles across cached reads", async () => {
    const f = await fixture();
    const profile: AIAnalysisSubject = { kind: "profile", profileId: "review", targetId: "codex" };
    const preview = await f.service.prepare(profile, "en");
    f.request.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      overview: "Resolve conflicting commit instructions.", findings: [{ category: "risk", title: "Automatic commits bypass approval", detail: "Two instructions disagree on when to commit.", suggestion: "Require approval before committing.", evidence: ["b"] }], limitations: []
    }) } }] });
    const result = await f.service.generate({ ...f.args, subject: profile, expectedKey: preview.key });
    const prompt = f.request.mock.calls[0][0].system;
    expect(prompt).toContain("zero to three findings");
    expect(prompt).toContain("Merge findings with the same root cause");
    expect(prompt).toContain("one concrete, minimal edit");
    expect(prompt).toContain("140 English words or 220 Chinese characters");
    expect((await f.service.prepare(profile, "en")).cached?.findings[0].title).toBe(result.findings[0].title);
  });
  it("accepts a Profile with no actionable findings without inventing an issue", async () => {
    const f = await fixture();
    const profile: AIAnalysisSubject = { kind: "profile", profileId: "review", targetId: "codex" };
    const preview = await f.service.prepare(profile, "en");
    f.request.mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ overview: "No important issue found in the supplied scope.", findings: [], limitations: [] }) } }] });
    expect((await f.service.generate({ ...f.args, subject: profile, expectedKey: preview.key })).findings).toEqual([]);
  });
  it("budgets the actual UTF-8 JSON payload including Chinese, emoji and escaped text", async () => {
    const documents = Array.from({ length: 250 }, (_, index) => ({ id: String(index), label: `文件${index}`, content: '中文😀\\"\n'.repeat(3000) }));
    const planned = planAnalysisBudget({ documents, warnings: [] });
    const content = analysisPayload(planned.documents, planned.warnings, planned.partial);
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(AI_INPUT_BYTES);
    expect(planned.partial).toBe(true);
    expect(planned.coverage.total).toBe(250);
    expect(planned.coverage.omitted).toBeGreaterThan(0);
    expect(planned.coverage.included + planned.coverage.omitted).toBe(250);
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    await createAIJsonClient(fetch)({ endpoint: 'http://localhost/mock', model: 'mock', key: '', system: '', content, signal: new AbortController().signal });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("hashes differences beyond the old first-198-file cutoff even when omitted from the request", async () => {
    const f = await fixture();
    f.input.documents = Array.from({ length: 250 }, (_, index) => ({ id: String(index), label: `File ${index}`, content: "x".repeat(2000) }));
    const before = await f.service.prepare(subject, "en");
    expect(before.coverage?.total).toBe(250);
    expect(before.partial).toBe(true);
    f.input.documents[249].content += "Changed";
    const after = await f.service.prepare(subject, "en");
    expect(after.key).not.toBe(before.key);
    await expect(f.service.generate({ ...f.args, expectedKey: before.key })).rejects.toThrow("inputs changed");
    expect(f.request).not.toHaveBeenCalled();
  });
  it("recovers damaged cache only after confirmation and preserves the original bytes", async () => {
    const f = await fixture();
    await f.service.generate(f.args);
    const path = join(f.dir, "ai-analyses", `${f.args.expectedKey}.json`);
    await writeFile(path, "damaged original");
    const preview = await f.service.prepare(subject, "en");
    expect(preview.cacheDamaged).toBe(true);
    expect(await readFile(path, "utf8")).toBe("damaged original");
    f.request.mockRejectedValueOnce(new Error("offline"));
    await expect(f.service.generate(f.args)).rejects.toThrow("offline");
    expect(await readFile(path, "utf8")).toBe("damaged original");
    const record = await f.service.generate(f.args);
    expect((await f.service.prepare(subject, "en")).cached).toEqual(record);
    const recovery = join(f.dir, "ai-analyses", "recovery");
    const files = await readdir(recovery);
    expect(files).toHaveLength(1);
    expect(await readFile(join(recovery, files[0]), "utf8")).toBe("damaged original");
  });
  it("reads Compare evidence without forwarding Workspace paths or inventing missing metrics", async () => {
    const side = { finalResponse: "Result", diff: "", durationMs: 12, fidelity: "partial", environment: "current", error: "incomplete" };
    const run = { result: { prompt: "Test", current: side, proposed: { ...side, environment: "proposed" }, fidelity: "partial", workspace: { path: "/private/project" } } } as unknown as OneShotEvaluationRun;
    const input = createAnalysisInputs({ profileStore: { readProfile: vi.fn() }, library: { listSkills: vi.fn() }, instructions: { read: vi.fn() }, evaluationService: { read: async () => run } });
    const result = await input({ kind: "comparison", runId: randomUUID() });
    expect(JSON.stringify(result)).not.toContain("/private/project");
    expect(result.documents[1].content).toContain('"usage":"Unavailable"');
    expect(result.warnings).toHaveLength(2);
  });
  it("excludes disabled groups and globally disabled Skills without reading their content", async () => {
    const skills = [
      { libraryId: "grouped", enabled: true, groupIds: ["off-group"] },
      { libraryId: "global-off", enabled: true }
    ];
    const profile = { instructions: "", resources: { instructions: [], skills, skillGroups: [{ id: "off-group", enabled: false }], mcpByTarget: {}, managementByTarget: { codex: { instructions: "disable", skills: "manage" } } } } as unknown as ProfileDetail;
    const input = createAnalysisInputs({ profileStore: { readProfile: async () => profile },
      library: { listSkills: vi.fn().mockResolvedValue([{ id: "global-off", globallyEnabled: false, path: "/must-not-read" }]) },
      instructions: { read: vi.fn() }, evaluationService: { read: vi.fn() } });
    const result = await input({ kind: "profile", profileId: "test", targetId: "codex" });
    expect(result.documents).toHaveLength(1); expect(JSON.stringify(result)).not.toContain("missing from Library");
  });
  it("never generates on preparation and persists confirmed results for reuse across services", async () => {
    const f = await fixture(); expect(f.request).not.toHaveBeenCalled();
    await expect(f.service.generate({ ...f.args, confirmed: false as true })).rejects.toThrow();
    const result = await f.service.generate(f.args); expect(f.request).toHaveBeenCalledTimes(1);
    expect((await f.service.prepare(subject, "en")).cached).toEqual(result);
    const other = createAnalysisService({ root: f.dir, configStore: f.config, readInput: f.readInput, request: f.request });
    await other.generate(f.args); expect(f.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(join(f.dir, "ai-analyses", `${result.key}.json`), "utf8")).overview).toBe(result.overview);
  });
  it("binds both locale and all input content to the preview", async () => {
    const f = await fixture(); expect((await f.service.prepare(subject, "zh_CN")).key).not.toBe(f.args.expectedKey);
    f.input.documents = [...f.input.documents, { id: "c", label: "Changed", content: "New" }];
    await expect(f.service.generate(f.args)).rejects.toThrow("inputs changed"); expect(f.request).not.toHaveBeenCalled();
  });
  it("reopens cached analyses with more scope warnings than the model output limit", async () => {
    const f = await fixture();
    f.input.warnings = Array.from({ length: 12 }, (_, index) => `Skill ${index} is unavailable.`);
    const preview = await f.service.prepare(subject, "en");
    const result = await f.service.generate({ ...f.args, expectedKey: preview.key });
    expect(result.limitations).toHaveLength(12);
    expect((await f.service.prepare(subject, "en")).cached).toEqual(result);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("rejects a changed service before sending", async () => {
    const f = await fixture(); await f.config.saveConfig({ endpoint: "http://localhost/new", model: "fixture" });
    await expect(f.service.generate(f.args)).rejects.toThrow("service changed"); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(["length", "invalid-evidence"])("preserves old results after %s regeneration failure", async (failure) => {
    const f = await fixture(); const old = await f.service.generate(f.args);
    f.request.mockResolvedValue({ choices: [{ finish_reason: failure === "length" ? "length" : "stop", message: { content: JSON.stringify({ overview: "Wrong", findings: [{ category: "risk", detail: "Unknown", suggestion: "", evidence: ["not-supplied"] }], limitations: [] }) } }] });
    await expect(f.service.generate({ ...f.args, regenerate: true })).rejects.toThrow("Previous results are kept");
    expect((await f.service.prepare(subject, "en")).cached).toEqual(old);
  });
  it("marks truncation, redacts secrets and hashes the complete input", async () => {
    const f = await fixture(); f.input.documents = [{ id: "a", label: "Long", content: 'api_key="sk-secret123456789012345678901234567890"\n' + "a".repeat(60_000) }];
    const a = await f.service.prepare(subject, "en"); expect(a.partial).toBe(true); expect(a.documents[0].content.length).toBeLessThan(13_000);
    expect(a.documents[0].content).not.toContain("sk-secret123456789");
    f.input.documents[0].content += "trailing change"; expect((await f.service.prepare(subject, "en")).key).not.toBe(a.key);
  });
  it("does not persist cancelled requests", async () => {
    const f = await fixture(); f.request.mockImplementation(async ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")))));
    const pending = f.service.generate(f.args); const assertion = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(f.request).toHaveBeenCalled()); f.service.cancel(f.args.requestId); await assertion;
    expect((await f.service.prepare(subject, "en")).cached).toBeUndefined();
  });
  it("sends only Profile policy for ignored resources and no native MCP definitions", async () => {
    const profile = { instructions: "PRIVATE", resources: { skills: [], instructions: [], managementByTarget: { codex: { instructions: "ignore", skills: "ignore" } }, mcpByTarget: { codex: { mode: "manage", selections: [{ name: "test", enabled: true, env: { SECRET: "hidden" } }] } } } } as unknown as ProfileDetail;
    const skills = vi.fn(); const instructions = vi.fn();
    const input = createAnalysisInputs({ profileStore: { readProfile: async () => profile }, library: { listSkills: skills }, instructions: { read: instructions }, evaluationService: { read: vi.fn() } });
    const result = await input({ kind: "profile", profileId: "test", targetId: "codex" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|hidden|SECRET/); expect(skills).not.toHaveBeenCalled(); expect(instructions).not.toHaveBeenCalled();
    expect(result.documents[0].content).toContain('"name":"test"'); expect(result.warnings.length).toBe(1);
  });
});
