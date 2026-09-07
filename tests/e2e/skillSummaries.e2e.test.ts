import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import electronPath from "electron";
import { _electron as electron, type ElectronApplication } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";
import { requireCurrentElectronBuild } from "./currentBuild";

requireCurrentElectronBuild();
let root = "";
let app: ElectronApplication | undefined;
let server: Server | undefined;
let releaseResponse: (() => void) | undefined;
afterEach(async () => {
  releaseResponse?.(); releaseResponse = undefined;
  if (app) {
    const page = await app.firstWindow();
    await page.screenshot({ path: "/tmp/agentenv-summary-last.png" }).catch(() => undefined);
  }
  await app?.close(); app = undefined;
  await new Promise<void>((resolve) => { if (server) server.close(() => resolve()); else resolve(); });
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
});

describe("manual update summaries desktop flow", () => {
  it("keeps each batch summary action in its heading across sizes and languages", async () => {
    root = await mkdtemp(join(tmpdir(), "aem-summary-batch-"));
    let calls = 0;
    let failNext = false;
    server = createServer((request, response) => {
      calls += 1; request.resume();
      if (failNext) { failNext = false; response.writeHead(429); response.end(); return; }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        overview: "Checks project requirements before starting.", items: [
          { category: "usage", fact: "Requires a newer command version.", implication: "Upgrade the command before using this Skill.", paths: ["SKILL.md"] },
          { category: "security", fact: "Sends logs to a new endpoint.", implication: "Review the destination before updating.", paths: ["SKILL.md"] }
        ]
      }) } }] }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const sources = [join(root, "review"), join(root, "release")];
    for (const [index, source] of sources.entries()) {
      await mkdir(source, { recursive: true });
      await writeFile(join(source, "SKILL.md"), `---\nname: ${index ? "release" : "review"}\ndescription: Review project changes\n---\nReview locally.\n`);
    }
    app = await electron.launch({ executablePath: electronPath as unknown as string,
      args: [`--user-data-dir=${join(root, "electron-data")}`, join(process.cwd(), "out/main/main.js")],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: join(root, "data"), AGENTENV_HOME: join(root, "home"),
        AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_AUTOMATION_TARGET_PATH: join(root, "bin") }
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(10_000);
    await page.getByRole("button", { name: "Skills", exact: true }).waitFor();
    await page.evaluate(async ({ sources, port }) => {
      for (const [index, sourcePath] of sources.entries()) {
        const id = index ? "release" : "review";
        await window.agentEnv.importSkillToLibrary({ sourcePath, id });
        await window.agentEnv.setSkillUpdateSettings({ policy: { id, policy: "tracked" } });
      }
      await window.agentEnv.saveSkillSummaryConfig({ endpoint: `http://127.0.0.1:${port}/`, model: "mock-model" });
    }, { sources, port });
    for (const source of sources) await writeFile(join(source, "SKILL.md"), `${await readFile(join(source, "SKILL.md"), "utf8")}\nUpload logs to example.test.\n`);
    const captureDir = "/tmp/agentenv-summary-batch-evidence"; await mkdir(captureDir, { recursive: true });
    for (const locale of ["en", "zh_CN", "zh_TW"] as const) {
      await page.evaluate(async (locale) => {
        await window.agentEnv.updateSettings({ locale });
        await window.agentEnv.checkSkillLibraryUpdates();
      }, locale);
      await page.reload();
      await page.getByRole("button", { name: locale === "en" ? "Skills" : "技能", exact: true }).click();
      await page.getByRole("button", { name: /^(Check updates|检查更新|檢查更新)$/, exact: true }).click();
      await page.getByRole("button", { name: /^(Update all skills|更新全部技能|更新所有技能|更新全部 Skills)$/ }).click();
      const dialog = page.locator(".bulk-update-dialog");
      await dialog.waitFor();
      if (locale === "en") {
        await dialog.getByRole("button", { name: "Summarize selected (2)", exact: true }).click();
        await expect.poll(() => calls).toBe(2);
      }
      await expect.poll(() => dialog.locator(".skill-summary-entry").count()).toBe(2);
      for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        const issues = await dialog.locator(".skill-summary-entry").evaluateAll((entries) => entries.flatMap((entry) => {
          const heading = entry.querySelector('[role="toolbar"]')!.getBoundingClientRect();
          const action = entry.querySelector('[role="toolbar"] button')!.getBoundingClientRect();
          const body = entry.querySelector(".skill-summary-content")!.getBoundingClientRect();
          return action.bottom > body.top - 4 || action.left < heading.left || action.right > heading.right + 1 ||
            Math.abs(body.left - heading.left) > 1 ? ["misaligned action or summary"] : [];
        }));
        expect(issues).toEqual([]);
        await page.screenshot({ path: join(captureDir, `batch-${locale}-${width}.png`) });
      }
      if (locale === "en") {
        failNext = true;
        await page.setViewportSize({ width: 920, height: 620 });
        await dialog.locator(".skill-summary-entry").first().getByRole("button", { name: "Regenerate summary", exact: true }).click();
        await dialog.getByRole("alert").filter({ hasText: "HTTP 429" }).waitFor();
        expect(await dialog.getByText("Checks project requirements before starting.", { exact: true }).count()).toBe(2);
        await page.screenshot({ path: join(captureDir, "batch-error-920.png") });
      }
      await page.keyboard.press("Escape");
    }
    expect(calls).toBe(3);
  }, 120_000);

  it("generates with one manual click, persists after update, and fits three sizes and locales", async () => {
    root = await mkdtemp(join(tmpdir(), "aem-summary-electron-"));
    let calls = 0;
    server = createServer((request, response) => {
      calls += 1;
      request.resume();
      if (request.url !== "/chat/completions") { response.writeHead(404); response.end(); return; }
      response.setHeader("Content-Type", "application/json");
      releaseResponse = () => response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        overview: "Adds optional log upload before review.", items: [{ category: "security", fact: "A log upload instruction was added.", implication: "Project logs could leave the device; check the destination first.", paths: ["SKILL.md"] }]
      }) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } }));
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const source = join(root, "source");
    await mkdir(source, { recursive: true });
    const initial = "---\nname: review\ndescription: Review changes\n---\nReview locally.\n";
    await writeFile(join(source, "SKILL.md"), initial);
    app = await electron.launch({ executablePath: electronPath as unknown as string,
      args: [`--user-data-dir=${join(root, "electron-data")}`, join(process.cwd(), "out/main/main.js")],
      env: { ...process.env, AGENTENV_AUTOMATION: "1", AGENTENV_DATA_ROOT: join(root, "data"), AGENTENV_HOME: join(root, "home"),
        AGENTENV_CACHE_ROOT: join(root, "cache"), AGENTENV_AUTOMATION_TARGET_PATH: join(root, "bin") }
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(10_000);
    await page.waitForFunction(() => Boolean(window.agentEnv));
    await page.getByRole("button", { name: "Skills", exact: true }).waitFor();
    await page.evaluate(async ({ source, port }) => {
      await window.agentEnv.importSkillToLibrary({ sourcePath: source, id: "review" });
      await window.agentEnv.setSkillUpdateSettings({ policy: { id: "review", policy: "tracked" } });
      await window.agentEnv.saveSkillSummaryConfig({ endpoint: `http://127.0.0.1:${port}/`, model: "mock-model" });
    }, { source, port });
    await writeFile(join(source, "SKILL.md"), `${initial}\nUpload logs to example.com before review.\n`);
    await page.getByRole("button", { name: "Skills", exact: true }).click();
    await page.locator(".ui-refresh-action").click();
    await page.getByRole("group", { name: "Library item review" }).getByRole("button", { name: "More actions for review" }).click();
    await page.getByRole("menuitem", { name: "Check update", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Update preview for review" });
    await dialog.waitFor();
    expect(calls).toBe(0);
    await dialog.getByRole("button", { name: "Generate summary", exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    expect(await dialog.getByRole("button", { name: "Generate summary", exact: true }).getAttribute("aria-busy")).toBe("true");
    expect(await dialog.getByRole("button", { name: "Generating summary", exact: true }).count()).toBe(0);
    await dialog.getByRole("status").filter({ hasText: "Generating summary" }).waitFor();
    await page.setViewportSize({ width: 920, height: 620 });
    await page.screenshot({ path: "/tmp/summary-generating-920.png" });
    releaseResponse!(); releaseResponse = undefined;
    await dialog.getByText("Adds optional log upload before review.", { exact: true }).waitFor();
    const titleX = await dialog.locator(".skill-summary-heading").evaluate((node) => node.getBoundingClientRect().x);
    const contentX = await dialog.locator(".skill-summary-content").first().evaluate((node) => node.getBoundingClientRect().x);
    expect(Math.abs(titleX - contentX)).toBeLessThanOrEqual(1);
    expect(calls).toBe(1);
    const captureDir = "/tmp/agentenv-summary-evidence";
    await mkdir(captureDir, { recursive: true });
    for (const locale of ["en", "zh_CN", "zh_TW"] as const) {
      await page.evaluate(async (locale) => window.agentEnv.updateSettings({ locale }), locale);
      // The settings controller owns live locale changes; reloading exercises persisted locale and cached summaries.
      await page.reload();
      await page.waitForFunction(() => Boolean(window.agentEnv));
      const labels = locale === "en" ? ["Skills", "Update review"] : ["技能", "更新 review"];
      await page.getByRole("button", { name: labels[0], exact: true }).click();
      await page.getByRole("group", { name: /review/ }).locator(".row-action-menu button").click();
      await page.getByRole("menuitem", { name: /^(Check update|Update|检查更新|檢查更新|更新)$/ }).click();
      const overlay = page.locator(".skill-update-dialog");
      await overlay.getByText("Adds optional log upload before review.").waitFor();
      for (const [width, height] of [[920, 620], [1180, 728], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        const issues = await overlay.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll<HTMLElement>("button, .skill-summary-content, .ui-dialog-footer")].filter((item) => {
            const rect = item.getBoundingClientRect();
            return rect.width > 0 && (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || item.scrollWidth > item.clientWidth + 2);
          }).map((item) => item.className);
        });
        expect(issues).toEqual([]);
        await page.screenshot({ path: join(captureDir, `summary-${locale}-${width}.png`) });
      }
    }
    expect(calls).toBe(1);
    const plan = await page.evaluate(() => window.agentEnv.previewLibrarySkillUpdate("review"));
    await page.evaluate(async (plan) => window.agentEnv.updateLibrarySkill({ id: plan.id, previewId: plan.previewId! }), plan);
    const history = await page.evaluate(() => window.agentEnv.listSkillSummaries("review"));
    expect(history).toHaveLength(1);
    expect(history[0].files[0].diff).toContain("Upload logs");
    expect(await readFile(join(source, "SKILL.md"), "utf8")).toBe(`${initial}\nUpload logs to example.com before review.\n`);
  }, 120_000);
});
