import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
