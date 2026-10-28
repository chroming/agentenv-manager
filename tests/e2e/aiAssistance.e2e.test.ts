import { setSkillCatalogStatus, openSkillCatalogAction } from "./skillCatalogControls";
import { createServer, type Server } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";
requireCurrentElectronBuild();
let root = ""; let app: ElectronApplication | undefined; let server: Server | undefined;
afterEach(async () => {
  if (app) await (await app.firstWindow()).screenshot({ path: "/tmp/agentenv-ai-assistance-last.png" }).catch(() => undefined);
  await app?.close(); app = undefined;
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve()); server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
});
it("recovers partial analysis and retries persistence without another model call", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-ai-reliability-"));
  let calls = 0;
  server = createServer((request, response) => {
    calls++; request.resume(); response.setHeader("Content-Type", "application/json");
    if (calls === 1) {
      response.writeHead(429, { "x-request-id": "req_fixture_quota" });
      response.end(JSON.stringify({ error: { code: "insufficient_quota", message: "private-provider-message" } })); return;
    }
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      overview: "Review the changed instructions before applying.", findings: [
        { category: "risk", title: null, detail: "The workflow can send project logs outside the device.", suggestion: null, evidence: ["D1"] },
        { category: "new-category", detail: "The destination needs verification.", suggestion: "", evidence: ["D1"] },
        { category: "risk", detail: { unexpected: "Inspect this original finding." } }
      ], limitations: []
    }) } }] }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  app = await electron.launch({ executablePath: electronPath as unknown as string,
    args: [`--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out/main/main.js")],
    env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: join(root, "data"), AGENTENV_HOME: join(root, "home"), AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_AUTOMATION_TARGET_PATH: join(root, "bin") }
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
  await page.getByRole("button", { name: "Profiles", exact: true }).waitFor();
  const id = await page.evaluate(async (port) => {
    await window.agentEnv.saveSkillSummaryConfig({ endpoint: `http://127.0.0.1:${port}/api`, model: "mock-analysis" });
    return (await window.agentEnv.createProfile({ name: "Reliability fixture", preferredTargetId: "codex" })).id;
  }, port);
  const before = await page.evaluate((id) => window.agentEnv.readProfile(id), id);
  const captures = process.env.AGENTENV_CAPTURE_AI_DIR ?? "/tmp/agentenv-ai-reliability-evidence"; await mkdir(captures, { recursive: true });
  for (const locale of ["en", "zh_CN", "zh_TW"] as const) {
    await page.evaluate((locale) => window.agentEnv.updateSettings({ locale }), locale); await page.reload();
    await page.getByRole("button", { name: locale === "en" ? "Profiles" : locale === "zh_CN" ? "配置方案" : "設定檔", exact: true }).click();
    await page.getByRole("button", { name: /More Profile actions|更多配置方案操作|更多.*操作/ }).click();
    await page.getByRole("menuitem", { name: locale === "en" ? "Analyze Profile" : "分析 Profile", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: locale === "en" ? "Profile analysis" : "Profile 分析", exact: true });
    const analyze = dialog.getByRole("button", { name: locale === "en" ? "Analyze Profile" : "分析 Profile", exact: true });
    if (locale === "en") {
      await analyze.click();
      await dialog.getByRole("alert").filter({ hasText: "no available quota" }).waitFor();
      expect(calls).toBe(1);
      expect(await dialog.getByText("private-provider-message").count()).toBe(0);
      const preview = await page.evaluate((id) => window.agentEnv.prepareAIAnalysis({ kind: "profile", profileId: id, targetId: "codex" }, "en"), id);
      const cachePath = join(root, "data", "ai-analyses", `${preview.key}.json`);
      await mkdir(cachePath, { recursive: true });
      await dialog.getByRole("button", { name: "Retry", exact: true }).click();
      await dialog.getByText("Review the changed instructions before applying.", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Retry saving", exact: true }).waitFor();
      expect(calls).toBe(2);
      await page.setViewportSize({ width: 920, height: 620 });
      await page.screenshot({ path: join(captures, "ai-reliability-unsaved-en-920.png"), animations: "disabled" });
      await rm(cachePath, { recursive: true });
      await page.evaluate(async () => { const prefs = await window.agentEnv.readAIPreferences(); await window.agentEnv.saveAIPreferences({ ...prefs, enabled: false }); });
      await dialog.getByRole("button", { name: "Retry saving", exact: true }).click();
      await dialog.getByRole("button", { name: "Retry saving", exact: true }).waitFor({ state: "hidden" });
      expect(calls).toBe(2);
      const stored = JSON.parse(await readFile(cachePath, "utf8"));
      expect(stored.partial).toBe(true); expect(stored.responseIssues).toEqual(["invalid-items", "unclassified"]);
      expect(stored.findings).toHaveLength(2); expect(stored.savePending).toBeUndefined();
      await page.evaluate(async () => { const prefs = await window.agentEnv.readAIPreferences(); await window.agentEnv.saveAIPreferences({ ...prefs, enabled: true }); });
    } else {
      await analyze.click();
      await dialog.getByText("Review the changed instructions before applying.", { exact: true }).waitFor();
    }
    for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      expect(await dialog.evaluate((node) => [...node.querySelectorAll<HTMLElement>("button, .ui-notice, .ui-dialog-footer")].filter((el) => {
        const outer = node.getBoundingClientRect(); const rect = el.getBoundingClientRect();
        return rect.width > 0 && (rect.left < outer.left - 1 || rect.right > outer.right + 1 || el.scrollWidth > el.clientWidth + 2);
      }).map((el) => el.className))).toEqual([]);
      await page.screenshot({ path: join(captures, `ai-reliability-partial-${locale}-${width}.png`), animations: "disabled" });
    }
    if (locale === "en") {
      await page.setViewportSize({ width: 920, height: 620 });
      await dialog.getByText("Evidence and scope", { exact: true }).click();
      await dialog.getByText("Original AI response", { exact: true }).click();
      await expect.poll(() => dialog.locator(".syntax-code-preview").textContent()).toContain("Inspect this original finding.");
      await dialog.getByRole("button", { name: "Maximize preview", exact: true }).click();
      await page.screenshot({ path: join(captures, "ai-reliability-original-en-920.png"), animations: "disabled" });
      expect(calls).toBe(2);
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  }
  expect(calls).toBe(4);
  expect((await page.evaluate((id) => window.agentEnv.readProfile(id), id)).contentHash).toBe(before.contentHash);
}, 120_000);
it("analyzes two local versions before import, configures in place and leaves originals untouched", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-local-analysis-")); let calls = 0;
  server = createServer((request, response) => {
    calls++; request.resume(); response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      overview: "These versions cover different review tasks.", findings: [], limitations: ["Only supplied files were analyzed."]
    }) } }] }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const bin = join(root, "bin"); await mkdir(bin, { recursive: true });
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data", "settings.json"), JSON.stringify({ locale: "en", telemetryEnabled: false,
    enabledTargetIds: ["codex", "claude-code"], agentDiscoveryVersion: 1, agentDiscoveryReviewedIds: ["codex", "claude-code"] }));
  const copies = [join(root, "home", ".codex", "skills", "review"), join(root, "home", ".claude", "skills", "review")];
  for (const [index, dir] of copies.entries()) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: review\ndescription: Review work\n---\nReview ${index ? "documentation" : "tests"}.\n`);
  }
  for (const [command, version] of [["codex", "codex-cli 0.100.0"], ["claude", "2.0.0 (Claude Code)"]]) {
    await writeFile(join(bin, command), `#!/bin/sh\nprintf '%s\\n' '${version}'\n`); await chmod(join(bin, command), 0o755);
  }
  const before = await Promise.all(copies.map((dir) => readFile(join(dir, "SKILL.md"), "utf8")));
  app = await electron.launch({ executablePath: electronPath as unknown as string,
    args: [`--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out/main/main.js")],
    env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: join(root, "data"), AGENTENV_HOME: join(root, "home"), AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_AUTOMATION_TARGET_PATH: bin }
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
  await page.getByRole("button", { name: "Skills", exact: true }).click();
  await openSkillCatalogAction(page, "Local Skills");
  const group = page.getByRole("group", { name: "Cleanup group review" });
  await group.getByRole("button", { name: "Add to Library review", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Review skill cleanup" });
  await dialog.getByRole("button", { name: "Analyze differences", exact: true }).click();
  expect(calls).toBe(0);
  await dialog.getByRole("button", { name: "Configure AI service", exact: true }).click();
  await dialog.getByRole("textbox", { name: "API endpoint", exact: true }).fill(`http://127.0.0.1:${port}/v1`);
  await dialog.getByRole("textbox", { name: "Model", exact: true }).fill("fixture");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("textbox", { name: "API endpoint", exact: true }).waitFor({ state: "hidden" });
  expect(calls).toBe(0);
  await dialog.getByRole("button", { name: "Analyze differences", exact: true }).click();
  await dialog.getByText("These versions cover different review tasks.", { exact: true }).waitFor();
  expect(calls).toBe(1);
  const captureDir = "/tmp/agentenv-local-analysis-evidence"; await mkdir(captureDir, { recursive: true });
  for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: join(captureDir, `duplicates-${width}.png`) });
  }
  expect(await page.evaluate(() => window.agentEnv.listSkillLibrary())).toEqual([]);
  expect(await Promise.all(copies.map((dir) => readFile(join(dir, "SKILL.md"), "utf8")))).toEqual(before);
}, 60_000);
it("gates all model calls and reviews a saved Profile across locales, sizes and restart", async () => {
  root = await mkdtemp(join(tmpdir(), "aem-ai-e2e-")); let calls = 0;
  server = createServer((request, response) => {
    calls++; request.resume(); response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
      overview: "Resolve the commit policy before applying.", findings: [
        { category: "risk", title: "Automatic commits bypass approval", detail: "The review Skill asks for immediate commits, but the instruction requires approval.", suggestion: "Require approval before the commit step.", evidence: ["scope"] },
        { category: "suggestion", title: "Review rules are repeated", detail: "Two instructions describe the same review checklist.", suggestion: "Keep the checklist in one instruction and reference it from the other.", evidence: ["scope"] },
        { category: "suggestion", title: "Test expectations are unclear", detail: "The workflow asks for test evidence without specifying which checks to run.", suggestion: "Name the project's test command in the instruction.", evidence: ["scope"] }
      ], limitations: ["This is a fixture analysis, not a safety guarantee."]
    }) } }] }));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve)); const port = (server.address() as { port: number }).port;
  app = await electron.launch({ executablePath: electronPath as unknown as string,
    args: [`--user-data-dir=${join(root, "electron")}`, join(process.cwd(), "out/main/main.js")],
    env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: join(root, "data"), AGENTENV_HOME: join(root, "home"), AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_AUTOMATION_TARGET_PATH: join(root, "bin") }
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
  await page.getByRole("button", { name: "Profiles", exact: true }).waitFor();
  const id = await page.evaluate(async (port) => {
    await window.agentEnv.saveSkillSummaryConfig({ endpoint: `http://127.0.0.1:${port}/api`, model: "mock-analysis" });
    return (await window.agentEnv.createProfile({ name: "Analysis fixture", preferredTargetId: "codex" })).id;
  }, port);
  const before = await page.evaluate((id) => window.agentEnv.readProfile(id), id);
  const captures = "/tmp/agentenv-ai-assistance-evidence"; await mkdir(captures, { recursive: true });
  for (const [index, locale] of (["en", "zh_CN", "zh_TW"] as const).entries()) {
    await page.evaluate((locale) => window.agentEnv.updateSettings({ locale }), locale); await page.reload();
    await page.getByRole("button", { name: locale === "en" ? "Profiles" : locale === "zh_CN" ? "配置方案" : "設定檔", exact: true }).click();
    await page.getByRole("button", { name: /More Profile actions|更多配置方案操作|更多.*操作/ }).click();
    const analysisEntry = page.getByRole("menuitem", { name: locale === "en" ? "Analyze Profile" : "分析 Profile", exact: true });
    expect(await analysisEntry.locator("svg").count()).toBe(1);
    await analysisEntry.click();
    const dialog = page.getByRole("dialog", { name: locale === "en" ? "Profile analysis" : "Profile 分析", exact: true });
    const analyze = dialog.getByRole("button", { name: locale === "en" ? "Analyze Profile" : "分析 Profile", exact: true });
    await page.screenshot({ path: join(captures, `profile-${locale}-idle.png`) });
    expect(calls).toBe(index); await analyze.click();
    await dialog.getByText("Resolve the commit policy before applying.", { exact: true }).waitFor(); expect(calls).toBe(index + 1);
    expect(await dialog.locator("h4").allTextContents()).toEqual(["Automatic commits bypass approval", "Review rules are repeated", "Test expectations are unclear"]);
    for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const overflow = await dialog.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return [...node.querySelectorAll<HTMLElement>("button, .skill-summary-content, .ui-dialog-footer")].filter((el) => {
          const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < rect.left - 1 || r.right > rect.right + 1 || el.scrollWidth > el.clientWidth + 2);
        }).map((el) => el.className);
      });
      expect(overflow).toEqual([]); await page.screenshot({ path: join(captures, `profile-${locale}-${width}.png`) });
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  }
  expect((await page.evaluate((id) => window.agentEnv.readProfile(id), id)).contentHash).toBe(before.contentHash);
  await page.evaluate(() => window.agentEnv.updateSettings({ locale: "en" })); await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "AI assistance", exact: true }).click();
  for (const [width, height] of [[920, 620], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const lanes = await page.locator(".settings-preference-control").evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().right));
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: join(captures, `settings-en-${width}.png`) });
  }
  const rejected = await page.evaluate(async (id) => {
    const prefs = await window.agentEnv.readAIPreferences(); await window.agentEnv.saveAIPreferences({ ...prefs, enabled: false });
    const subject = { kind: "profile" as const, profileId: id, targetId: "codex" };
    const preview = await window.agentEnv.prepareAIAnalysis(subject, "en");
    if (!preview.cached) throw new Error("Cache missing");
    const error = async (run: () => Promise<unknown>) => { try { await run(); return "unexpected success"; } catch (error) { return String(error); } };
    return Promise.all([
      error(() => window.agentEnv.generateAIAnalysis({ subject, locale: "en", expectedKey: preview.key, confirmed: true, regenerate: true, expectedEndpoint: "", expectedModel: "", requestId: crypto.randomUUID() })),
      error(() => window.agentEnv.generateSkillSummary({ previewId: crypto.randomUUID(), requestId: crypto.randomUUID(), expectedEndpoint: "", expectedModel: "", confirmed: true, locale: "en" })),
      error(() => window.agentEnv.generateSkillTagSuggestions({ skillId: "missing", expectedKey: "0".repeat(64), requestId: crypto.randomUUID(), expectedEndpoint: "", expectedModel: "", confirmed: true, locale: "en" }))
    ]);
  }, id);
  expect(rejected.every((error) => error.includes("turned off"))).toBe(true); expect(calls).toBe(3);
  await page.reload(); expect((await page.evaluate(() => window.agentEnv.readAIPreferences())).enabled).toBe(false);
}, 120_000);
